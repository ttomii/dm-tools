// © TOMII, Tatsuru

use encoding_rs::Encoding;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

/// Preserve index records and their association with input mesh records.
pub fn collect(files: &[PathBuf], encoding: &'static Encoding) -> io::Result<Value> {
    let mut base = files[0].parent().unwrap_or(Path::new(""));
    while !files.iter().all(|file| file.starts_with(base)) {
        base = base.parent().unwrap_or(Path::new(""));
    }
    let relative = |path: &Path| {
        path.strip_prefix(base)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    };
    let mut dm_meshes = Vec::new();
    for file in files {
        dm_meshes.push((file, mesh_levels(file, encoding)?));
    }
    let parents: BTreeSet<_> = files.iter().filter_map(|p| p.parent()).collect();
    let mut paths = BTreeSet::new();
    for parent in parents {
        for entry in fs::read_dir(parent)? {
            let entry = entry?;
            if entry.file_type()?.is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("dmi"))
            {
                paths.insert(entry.path());
            }
        }
    }
    let mut indexes = Vec::new();
    for path in paths {
        let mut index = parse(&fs::read(&path)?, encoding).map_err(|error| {
            io::Error::new(
                ErrorKind::InvalidData,
                format!("{}: {error}", path.display()),
            )
        })?;
        let ids: BTreeSet<_> = index["meshes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| mesh_key(id.as_str().unwrap()))
            .collect();
        let mut levels: BTreeSet<i64> = BTreeSet::new();
        let mut dm_files = BTreeSet::new();
        for id in &ids {
            let matches: Vec<_> = dm_meshes
                .iter()
                .filter(|(_, meshes)| meshes.iter().any(|(mesh, _)| mesh == id))
                .collect();
            let local: Vec<_> = matches
                .iter()
                .copied()
                .filter(|(file, _)| file.parent() == path.parent())
                .collect();
            // A shared index may list mesh files in sibling directories. Do not
            // guess when a non-local identifier refers to multiple input files.
            let selected = if !local.is_empty() {
                local
            } else if matches.len() == 1 {
                matches
            } else {
                Vec::new()
            };
            for (file, meshes) in selected {
                dm_files.insert(relative(file));
                for (mesh, level) in meshes {
                    if mesh == id {
                        levels.extend(*level);
                    }
                }
            }
        }
        index["source"] = json!(relative(&path));
        index["mapLevels"] = json!(levels);
        index["dmFiles"] = json!(dm_files);
        indexes.push(index);
    }
    Ok(json!({"version": 1, "indexes": indexes}))
}

fn mesh_key(value: &str) -> String {
    let value = value.trim();
    if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) {
        let normalized = value.trim_start_matches('0');
        if normalized.is_empty() {
            "0".into()
        } else {
            normalized.into()
        }
    } else {
        value.to_string()
    }
}

fn mesh_levels(path: &Path, encoding: &'static Encoding) -> io::Result<Vec<(String, Option<i64>)>> {
    use std::io::{BufRead, BufReader};
    let mut result = Vec::new();
    let mut reader = BufReader::new(fs::File::open(path)?);
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        if line.starts_with(b"M ") && line.len() >= 35 {
            let (id, _, _) = encoding.decode(&line[2..10]);
            let level = std::str::from_utf8(&line[30..35])
                .ok()
                .and_then(|v| v.trim().parse::<i64>().ok())
                .filter(|level| *level > 0);
            result.push((mesh_key(&id), level));
        }
    }
    Ok(result)
}

pub fn store(connection: &rusqlite::Connection, metadata: &Value) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE dm_dmi_metadata (
        source_path TEXT PRIMARY KEY NOT NULL,
        map_levels TEXT NOT NULL,
        dm_files TEXT NOT NULL,
        json TEXT NOT NULL
    );",
    )?;
    let transaction = connection.unchecked_transaction()?;
    for index in metadata["indexes"].as_array().unwrap() {
        transaction.execute(
            "INSERT INTO dm_dmi_metadata VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                index["source"].as_str().unwrap(),
                index["mapLevels"].to_string(),
                index["dmFiles"].to_string(),
                index.to_string()
            ],
        )?;
    }
    transaction.commit()
}

pub fn read(
    connection: &rusqlite::Connection,
) -> Result<Option<Value>, crate::maplibre::MapLibreError> {
    if connection.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='dm_dmi_metadata'",
        [],
        |r| r.get::<_, i64>(0),
    )? == 0
    {
        return Ok(None);
    }
    let mut statement = connection.prepare(
        "SELECT source_path, map_levels, dm_files, json FROM dm_dmi_metadata ORDER BY source_path",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut indexes = Vec::new();
    for row in rows {
        let (source, levels, files, value) = row?;
        let mut index: Value = serde_json::from_str(&value)?;
        index["source"] = json!(source);
        index["mapLevels"] = serde_json::from_str(&levels)?;
        index["dmFiles"] = serde_json::from_str(&files)?;
        indexes.push(index);
    }
    Ok(if indexes.is_empty() {
        None
    } else {
        Some(json!({"version": 1, "indexes": indexes}))
    })
}

pub fn parse(bytes: &[u8], encoding: &'static Encoding) -> io::Result<Value> {
    let lines: Vec<_> = bytes
        .split(|b| *b == b'\n')
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
        .filter(|line| !line.is_empty())
        .collect();
    let invalid = || io::Error::new(ErrorKind::InvalidData, "invalid DMI index records");
    if lines.is_empty() || !lines[0].starts_with(b"I ") || lines.iter().any(|l| l.len() != 84) {
        return Err(invalid());
    }
    let text = |line: &[u8], start: usize, end: usize| -> io::Result<String> {
        let (value, _, errors) = encoding.decode(&line[start..end]);
        if errors {
            return Err(invalid());
        }
        Ok(value.trim().to_string())
    };
    let number = |line: &[u8], start: usize, end: usize| -> io::Result<u32> {
        let value = text(line, start, end)?;
        if value.is_empty() {
            return Ok(0);
        }
        value.parse().map_err(|_| invalid())
    };
    let h = lines[0];
    let mesh_records = number(h, 37, 39)? as usize;
    let classification_count = number(h, 39, 43)? as usize;
    let mesh_count = number(h, 34, 37)? as usize;
    if lines.len() != 1 + mesh_records + classification_count || mesh_count > mesh_records * 10 {
        return Err(invalid());
    }
    let mut meshes = Vec::new();
    for row in &lines[1..1 + mesh_records] {
        for offset in (0..80).step_by(8) {
            let id = text(row, offset, offset + 8)?;
            if !id.is_empty() {
                meshes.push(id);
            }
        }
    }
    if meshes.len() != mesh_count {
        return Err(invalid());
    }
    let mut classifications = Vec::new();
    for row in &lines[1 + mesh_records..] {
        let types = (8..17)
            .map(|i| number(row, i, i + 1))
            .collect::<io::Result<Vec<_>>>()?;
        classifications.push(json!({
            "usedCode": text(row, 0, 4)?, "standardCode": text(row, 4, 8)?,
            "types": types, "direction": number(row, 17, 18)?,
            "dimension": number(row, 18, 19)?, "description": text(row, 19, 84)?
        }));
    }
    Ok(json!({
        "zone": number(h, 2, 4)?, "planner": text(h, 4, 34)?,
        "meshCount": mesh_count, "meshes": meshes,
        "classificationCount": classification_count, "classifications": classifications,
        "displacement": number(h, 43, 44)?, "interruption": number(h, 44, 45)?,
        "ruleYear": number(h, 45, 49)?, "ruleName": text(h, 49, 79)?,
        "formatVersion": number(h, 79, 80)?, "spareUsage": number(h, 80, 81)?
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_byte_offsets_and_custom_classification() {
        let mut header = [b' '; 84];
        header[..4].copy_from_slice(b"I  8");
        let (name, _, _) = encoding_rs::SHIFT_JIS.encode("静岡市");
        header[4..4 + name.len()].copy_from_slice(&name);
        header[34..37].copy_from_slice(b"  1");
        header[37..39].copy_from_slice(b" 1");
        header[39..43].copy_from_slice(b"   1");
        header[43..49].copy_from_slice(b"012008");
        header[79] = b'2';
        let mut mesh = [b' '; 84];
        mesh[..8].copy_from_slice(b"1       ");
        let mut code = [b' '; 84];
        code[..19].copy_from_slice(b"9999110301000000013");
        let bytes = [header.as_slice(), mesh.as_slice(), code.as_slice()].join(&b'\n');
        let value = parse(&bytes, encoding_rs::SHIFT_JIS).unwrap();
        assert_eq!(value["planner"], "静岡市");
        assert_eq!(value["zone"], 8);
        assert_eq!(value["meshes"], json!(["1"]));
        assert_eq!(value["classifications"][0]["usedCode"], "9999");
        assert_eq!(value["classifications"][0]["standardCode"], "1103");
        assert_eq!(value["classifications"][0]["direction"], 1);
        assert_eq!(value["classifications"][0]["dimension"], 3);
        assert!(parse(&bytes[..bytes.len() - 1], encoding_rs::SHIFT_JIS).is_err());
    }
    fn index_record(mesh_ids: &[&str]) -> Vec<u8> {
        let mut header = [b' '; 84];
        header[..4].copy_from_slice(b"I  8");
        header[34..37].copy_from_slice(format!("{:3}", mesh_ids.len()).as_bytes());
        header[37..39].copy_from_slice(b" 1");
        let mut meshes = [b' '; 84];
        for (i, id) in mesh_ids.iter().enumerate() {
            meshes[i * 8..i * 8 + id.len()].copy_from_slice(id.as_bytes());
        }
        [header.as_slice(), meshes.as_slice()].join(&b'\n')
    }

    fn mesh_record(id: &str, level: i64) -> Vec<u8> {
        let mut record = [b' '; 84];
        record[..2].copy_from_slice(b"M ");
        record[2..2 + id.len()].copy_from_slice(id.as_bytes());
        record[30..35].copy_from_slice(format!("{level:5}").as_bytes());
        record.to_vec()
    }

    #[test]
    fn associates_multiple_indexes_and_levels_by_mesh_instead_of_directory_name() {
        let temp = tempfile::tempdir().unwrap();
        let a = temp.path().join("a.dm");
        let b = temp.path().join("b.dm");
        fs::write(
            &a,
            [mesh_record("01", 2500), mesh_record("B", 5000)].join(&b'\n'),
        )
        .unwrap();
        fs::write(&b, mesh_record("2", 10000)).unwrap();
        fs::write(temp.path().join("a.dmi"), index_record(&["1", "B"])).unwrap();
        fs::write(temp.path().join("b.DMI"), index_record(&["002"])).unwrap();
        fs::write(temp.path().join("unmatched.dmi"), index_record(&["OTHER"])).unwrap();
        let result = collect(&[a, b], encoding_rs::SHIFT_JIS).unwrap();
        let indexes = result["indexes"].as_array().unwrap();
        assert_eq!(indexes.len(), 3);
        assert_eq!(indexes[0]["mapLevels"], json!([2500, 5000]));
        assert_eq!(indexes[0]["dmFiles"], json!(["a.dm"]));
        assert_eq!(indexes[1]["mapLevels"], json!([10000]));
        assert_eq!(indexes[1]["dmFiles"], json!(["b.dm"]));
        assert_eq!(indexes[2]["mapLevels"], json!([]));
        assert_eq!(indexes[2]["dmFiles"], json!([]));
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        assert!(read(&connection).unwrap().is_none());
        store(&connection, &result).unwrap();
        let levels: String = connection
            .query_row(
                "SELECT map_levels FROM dm_dmi_metadata WHERE source_path='a.dmi'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(levels, "[2500,5000]");
        assert_eq!(read(&connection).unwrap().unwrap(), result);
    }

    #[test]
    fn keeps_same_named_indexes_in_different_folders_separate() {
        let temp = tempfile::tempdir().unwrap();
        let mut files = Vec::new();
        for (folder, level) in [("fine", 2500), ("coarse", 10000)] {
            let dir = temp.path().join(folder);
            fs::create_dir(&dir).unwrap();
            let dm = dir.join("01.dm");
            fs::write(&dm, mesh_record("1", level)).unwrap();
            fs::write(dir.join("index.dmi"), index_record(&["1"])).unwrap();
            files.push(dm);
        }
        let result = collect(&files, encoding_rs::SHIFT_JIS).unwrap();
        assert_eq!(result["indexes"][0]["source"], "coarse/index.dmi");
        assert_eq!(result["indexes"][0]["mapLevels"], json!([10000]));
        assert_eq!(result["indexes"][1]["source"], "fine/index.dmi");
        assert_eq!(result["indexes"][1]["mapLevels"], json!([2500]));
    }
    #[test]
    fn shared_index_matches_unique_meshes_in_sibling_directories() {
        let temp = tempfile::tempdir().unwrap();
        let local = temp.path().join("local");
        let sibling = temp.path().join("sibling");
        fs::create_dir(&local).unwrap();
        fs::create_dir(&sibling).unwrap();
        let a = local.join("a.dm");
        let b = sibling.join("b.dm");
        let c = sibling.join("c.dm");
        fs::write(&a, mesh_record("A", 2500)).unwrap();
        fs::write(
            &b,
            [mesh_record("B", 2500), mesh_record("C", 5000)].join(&b'\n'),
        )
        .unwrap();
        fs::write(&c, mesh_record("C", 10000)).unwrap();
        fs::write(local.join("index.dmi"), index_record(&["A", "B", "C"])).unwrap();
        let result = collect(&[a, b, c], encoding_rs::SHIFT_JIS).unwrap();
        let index = &result["indexes"][0];
        assert_eq!(index["mapLevels"], json!([2500]));
        assert_eq!(index["dmFiles"], json!(["local/a.dm", "sibling/b.dm"]));
    }
}
