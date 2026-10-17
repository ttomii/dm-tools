// Partial PMTiles updates keep projected features from only one input layer in memory.
use super::*;
use flate2::read::GzDecoder;
use pmtiles::{Compression, Header, TileId};
use std::io::{Read, Seek, SeekFrom, Write};

fn invalid(message: impl Into<String>) -> MapLibreError {
    MapLibreError::PartialUpdate(message.into())
}

pub fn update_tiles(
    gpkg: &Path,
    archive: &Path,
    level: i64,
    min_zoom: u8,
    max_zoom: u8,
) -> Result<u64, MapLibreError> {
    if min_zoom > max_zoom || max_zoom > MAX_ZOOM || level <= 0 {
        return Err(invalid(
            "require a positive map level and 0 <= min-zoom <= max-zoom <= 18",
        ));
    }
    let mut existing = Archive::open(archive)?;
    if min_zoom < existing.header.min_zoom || max_zoom > existing.header.max_zoom {
        return Err(invalid(
            "update zoom range must be inside the existing archive range",
        ));
    }
    let connection = Connection::open_with_flags(gpkg, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let layers = read_layers(&connection)?
        .into_iter()
        .filter(|layer| layer.level == level)
        .collect::<Vec<_>>();
    let mut statement =
        connection.prepare("SELECT table_name FROM gpkg_contents WHERE data_type = 'features'")?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if !names
        .iter()
        .any(|name| name.split('_').nth(4).and_then(|v| v.parse::<i64>().ok()) == Some(level))
    {
        return Err(invalid(format!(
            "map level {level} is absent from the GeoPackage"
        )));
    }
    let projector = Projector::new(&layers)?;
    let parent = archive
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".dm-tile-update-")
        .tempdir_in(parent)?;
    let generated = spool_layers(
        &connection,
        &layers,
        &projector,
        min_zoom..=max_zoom,
        staging.path(),
    )?;
    let output = tempfile::NamedTempFile::new_in(parent)?;
    let header = &existing.header;
    let mut writer = PmTilesWriter::new(TileType::Mvt)
        .min_zoom(header.min_zoom)
        .max_zoom(header.max_zoom)
        .bounds(
            header.min_longitude,
            header.min_latitude,
            header.max_longitude,
            header.max_latitude,
        )
        .center(header.center_longitude, header.center_latitude)
        .center_zoom(header.center_zoom)
        .metadata(&existing.metadata)
        .create(output.reopen()?)?;
    let keys = existing
        .tiles
        .keys()
        .copied()
        .chain(generated.iter().copied())
        .collect::<BTreeSet<_>>();
    let mut changed = 0;
    for (position, id) in keys.into_iter().enumerate() {
        let coord: TileCoord = TileId::new(id)?.into();
        let raw = existing.raw_tile(id)?;
        if !(min_zoom..=max_zoom).contains(&coord.z()) {
            writer.add_raw_tile(coord, &raw)?;
            continue;
        }
        let mut tile = if raw.is_empty() {
            vector_tile::Tile { layers: Vec::new() }
        } else {
            decode_tile(&raw)?
        };
        for layer in &mut tile.layers {
            let keys = &layer.keys;
            let values = &layer.values;
            layer
                .features
                .retain(|feature| !is_level(feature, keys, values, level));
        }
        for layer in &mut tile.layers {
            compact_layer(layer)?;
        }
        if generated.contains(&id) {
            let fragment = fs::read(staging.path().join(id.to_string()))?;
            let replacement = vector_tile::Tile::decode(fragment.as_slice())
                .map_err(|e| invalid(e.to_string()))?;
            merge_layers(&mut tile, replacement)?;
        }
        tile.layers.retain(|layer| !layer.features.is_empty());
        if !tile.layers.is_empty() {
            writer.add_tile(coord, &tile.encode_to_vec())?;
        }
        changed += 1;
        if position % 256 == 0 {
            eprintln!("updating archive: {position} tiles copied/processed");
        }
    }
    writer.finalize()?;
    output.as_file().sync_all()?;
    drop(existing);
    output
        .persist(archive)
        .map_err(|error| MapLibreError::Io(error.error))?;
    Ok(changed)
}

fn spool_layers(
    connection: &Connection,
    layers: &[GpkgLayer],
    projector: &Projector,
    zooms: RangeInclusive<u8>,
    directory: &Path,
) -> Result<BTreeSet<u64>, MapLibreError> {
    let mut generated = BTreeSet::new();
    for (position, layer) in layers.iter().enumerate() {
        eprintln!(
            "partial generation: layer {}/{} {}",
            position + 1,
            layers.len(),
            layer.table_name
        );
        let ranges = BTreeMap::from([(layer.level, zooms.clone())]);
        let candidates = tile_keys(std::slice::from_ref(layer), projector, &ranges)?;
        let mut tiles = BTreeMap::new();
        for feature in read_layer_features(connection, layer, projector)? {
            add_feature_to_tiles(
                &mut tiles,
                &candidates,
                &source_layer_from_table(layer),
                Arc::new(feature),
                zooms.clone(),
            );
        }
        for (key, tile_layers) in tiles {
            let id = TileId::from(TileCoord::new(key.z, key.x, key.y)?).value();
            let bytes = encode_tile(key, tile_layers)?;
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(directory.join(id.to_string()))?
                .write_all(&bytes)?;
            generated.insert(id);
        }
    }
    Ok(generated)
}

fn is_level(
    feature: &vector_tile::Feature,
    keys: &[String],
    values: &[vector_tile::Value],
    level: i64,
) -> bool {
    feature.tags.chunks_exact(2).any(|tag| {
        keys.get(tag[0] as usize).is_some_and(|key| key == "LEVEL")
            && values.get(tag[1] as usize).is_some_and(|value| {
                value.int_value == Some(level)
                    || value.uint_value == u64::try_from(level).ok()
                    || value.sint_value == Some(level)
                    || value.string_value.as_deref() == Some(&level.to_string())
            })
    })
}

fn compact_layer(layer: &mut vector_tile::Layer) -> Result<(), MapLibreError> {
    let old_keys = std::mem::take(&mut layer.keys);
    let old_values = std::mem::take(&mut layer.values);
    let mut keys = HashMap::new();
    let mut values = HashMap::new();
    for feature in &mut layer.features {
        if feature.tags.len() % 2 != 0 {
            return Err(invalid("invalid MVT tag list"));
        }
        for pair in feature.tags.chunks_exact_mut(2) {
            let key = old_keys
                .get(pair[0] as usize)
                .ok_or_else(|| invalid("invalid MVT key index"))?;
            let value = old_values
                .get(pair[1] as usize)
                .ok_or_else(|| invalid("invalid MVT value index"))?;
            pair[0] = *keys.entry(pair[0]).or_insert_with(|| {
                layer.keys.push(key.clone());
                (layer.keys.len() - 1) as u32
            });
            pair[1] = *values.entry(pair[1]).or_insert_with(|| {
                layer.values.push(value.clone());
                (layer.values.len() - 1) as u32
            });
        }
    }
    Ok(())
}

fn merge_layers(
    tile: &mut vector_tile::Tile,
    replacement: vector_tile::Tile,
) -> Result<(), MapLibreError> {
    for mut incoming in replacement.layers {
        if let Some(layer) = tile
            .layers
            .iter_mut()
            .find(|layer| layer.name == incoming.name)
        {
            if layer.extent != incoming.extent || layer.version != incoming.version {
                return Err(invalid(
                    "MVT layer version or extent differs from the existing archive",
                ));
            }
            let key_offset = layer.keys.len() as u32;
            let value_offset = layer.values.len() as u32;
            for feature in &mut incoming.features {
                for tag in feature.tags.chunks_exact_mut(2) {
                    tag[0] += key_offset;
                    tag[1] += value_offset;
                }
            }
            layer.keys.extend(incoming.keys);
            layer.values.extend(incoming.values);
            layer.features.extend(incoming.features);
        } else {
            tile.layers.push(incoming);
        }
    }
    Ok(())
}

fn decompress(bytes: &[u8]) -> Result<Vec<u8>, MapLibreError> {
    let mut output = Vec::new();
    GzDecoder::new(bytes)
        .take(128 * 1024 * 1024 + 1)
        .read_to_end(&mut output)?;
    if output.len() > 128 * 1024 * 1024 {
        return Err(invalid("decompressed PMTiles block exceeds 128 MiB"));
    }
    Ok(output)
}

fn decode_tile(bytes: &[u8]) -> Result<vector_tile::Tile, MapLibreError> {
    vector_tile::Tile::decode(decompress(bytes)?.as_slice()).map_err(|e| invalid(e.to_string()))
}

// PMTiles v3 directories are delta encoded. Only small directory blocks and one
// compressed tile are read at a time; the archive contents are never buffered.
struct Archive {
    file: File,
    header: Header,
    metadata: String,
    tiles: BTreeMap<u64, (u64, u64)>,
}

impl Archive {
    fn open(path: &Path) -> Result<Self, MapLibreError> {
        let mut file = File::open(path)?;
        let mut bytes = [0; 127];
        file.read_exact(&mut bytes)?;
        let header = Header::try_from_bytes(bytes.to_vec().into())?;
        if header.spec_version() != 3
            || header.tile_type != TileType::Mvt
            || header.internal_compression() != Compression::Gzip
            || header.tile_compression != Compression::Gzip
        {
            return Err(invalid(
                "partial updates require PMTiles v3 with gzip MVT and gzip directories",
            ));
        }
        let field = |offset| u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        let metadata =
            String::from_utf8(decompress(&read_block(&mut file, field(24), field(32))?)?)
                .map_err(|e| invalid(e.to_string()))?;
        let root = read_directory(&mut file, field(8), field(16))?;
        let mut tiles = BTreeMap::new();
        for entry in root {
            let entries = if entry.run == 0 {
                read_directory(
                    &mut file,
                    field(40)
                        .checked_add(entry.offset)
                        .ok_or_else(|| invalid("leaf offset overflow"))?,
                    entry.length,
                )?
            } else {
                vec![entry]
            };
            for entry in entries {
                if entry.run == 0 || tiles.len().saturating_add(entry.run as usize) > 2_000_000 {
                    return Err(invalid("invalid or excessively large PMTiles directory"));
                }
                for id in entry.id..entry.id + entry.run {
                    tiles.insert(
                        id,
                        (
                            field(56)
                                .checked_add(entry.offset)
                                .ok_or_else(|| invalid("tile offset overflow"))?,
                            entry.length,
                        ),
                    );
                }
            }
        }
        Ok(Self {
            file,
            header,
            metadata,
            tiles,
        })
    }

    fn raw_tile(&mut self, id: u64) -> Result<Vec<u8>, MapLibreError> {
        match self.tiles.get(&id) {
            Some(&(offset, length)) => read_block(&mut self.file, offset, length),
            None => Ok(Vec::new()),
        }
    }
}

fn read_block(file: &mut File, offset: u64, length: u64) -> Result<Vec<u8>, MapLibreError> {
    if length > 128 * 1024 * 1024
        || offset
            .checked_add(length)
            .is_none_or(|end| end > file.metadata().map(|m| m.len()).unwrap_or(0))
    {
        return Err(invalid("invalid PMTiles block offset or length"));
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = vec![0; length as usize];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

struct Entry {
    id: u64,
    run: u64,
    length: u64,
    offset: u64,
}

fn read_varint(bytes: &[u8], position: &mut usize) -> Result<u64, MapLibreError> {
    let mut value = 0;
    for shift in (0..70).step_by(7) {
        let byte = *bytes
            .get(*position)
            .ok_or_else(|| invalid("truncated PMTiles directory"))?;
        *position += 1;
        if shift == 63 && byte > 1 {
            return Err(invalid("invalid directory varint"));
        }
        value |= u64::from(byte & 127) << shift;
        if byte < 128 {
            return Ok(value);
        }
    }
    Err(invalid("invalid directory varint"))
}

fn read_directory(file: &mut File, offset: u64, length: u64) -> Result<Vec<Entry>, MapLibreError> {
    let bytes = decompress(&read_block(file, offset, length)?)?;
    let mut position = 0;
    let count = read_varint(&bytes, &mut position)?;
    if count > 2_000_000 {
        return Err(invalid("PMTiles directory exceeds 2 million entries"));
    }
    let mut entries = Vec::with_capacity(count as usize);
    let mut id = 0_u64;
    for _ in 0..count {
        id = id
            .checked_add(read_varint(&bytes, &mut position)?)
            .ok_or_else(|| invalid("directory tile ID overflow"))?;
        entries.push(Entry {
            id,
            run: 0,
            length: 0,
            offset: 0,
        });
    }
    for entry in &mut entries {
        entry.run = read_varint(&bytes, &mut position)?;
    }
    for entry in &mut entries {
        entry.length = read_varint(&bytes, &mut position)?;
    }
    let mut previous_end = 0;
    for (index, entry) in entries.iter_mut().enumerate() {
        let value = read_varint(&bytes, &mut position)?;
        entry.offset = if value == 0 && index > 0 {
            previous_end
        } else {
            value
                .checked_sub(1)
                .ok_or_else(|| invalid("invalid directory offset"))?
        };
        previous_end = entry
            .offset
            .checked_add(entry.length)
            .ok_or_else(|| invalid("directory offset overflow"))?;
        entry
            .id
            .checked_add(entry.run)
            .ok_or_else(|| invalid("directory run overflow"))?;
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpkg::{GeoPackageWriter, LayerKey};

    #[test]
    fn partial_update_preserves_other_levels_and_zooms_and_can_delete() {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("input.gpkg");
        let fine = super::super::tests::sample_feature();
        let mut coarse = fine.clone();
        coarse.map_level = Some(10000);
        let layer_keys = [
            LayerKey::from_feature(&fine),
            LayerKey::from_feature(&coarse),
        ];
        let mut writer = GeoPackageWriter::create(
            &input,
            &BTreeSet::from(layer_keys),
            &BTreeSet::new(),
            20,
            false,
        )
        .unwrap();
        writer.write(fine, 1).unwrap();
        writer.write(coarse, 2).unwrap();
        writer.finish().unwrap();
        drop(writer);
        let output = temp.path().join("out");
        fs::create_dir_all(&output).unwrap();
        let connection = Connection::open(&input).unwrap();
        let layers = read_layers(&connection).unwrap();
        let projector = Projector::new(&layers).unwrap();
        let summary = summarize_gpkg(&connection, &layers, &projector).unwrap();
        // Reproduce the old archive: z15 contains only 2500.
        let ranges = BTreeMap::from([(2500, 14..=18), (10000, 12..=14)]);
        let source = TileSource {
            connection: &connection,
            layers: &layers,
            projector: &projector,
            zoom_ranges: &ranges,
        };
        write_pmtiles(
            &output,
            "test",
            &summary,
            &source,
            tile_keys(&layers, &projector, &ranges).unwrap(),
            false,
        )
        .unwrap();
        drop(connection);
        let path = output.join("test.pmtiles");
        let mut before = Archive::open(&path).unwrap();
        let original = before
            .tiles
            .keys()
            .copied()
            .collect::<Vec<_>>()
            .into_iter()
            .map(|id| (id, before.raw_tile(id).unwrap()))
            .collect::<BTreeMap<_, _>>();
        drop(before);
        update_tiles(&input, &path, 10000, 15, 15).unwrap();
        let first = fs::read(&path).unwrap();
        update_tiles(&input, &path, 10000, 15, 15).unwrap();
        assert_eq!(
            first,
            fs::read(&path).unwrap(),
            "repeated updates must not duplicate dictionaries or features"
        );
        let mut archive = Archive::open(&path).unwrap();
        let ids = archive.tiles.keys().copied().collect::<Vec<_>>();
        let mut checked = false;
        for id in ids {
            let coord: TileCoord = TileId::new(id).unwrap().into();
            let raw = archive.raw_tile(id).unwrap();
            if coord.z() != 15 {
                assert_eq!(raw, original[&id]);
                continue;
            }
            let tile = decode_tile(&raw).unwrap();
            let levels = tile
                .layers
                .iter()
                .flat_map(|layer| {
                    layer.features.iter().filter_map(|feature| {
                        [2500, 10000]
                            .into_iter()
                            .find(|&level| is_level(feature, &layer.keys, &layer.values, level))
                    })
                })
                .collect::<Vec<_>>();
            assert_eq!(levels.iter().filter(|&&level| level == 2500).count(), 1);
            assert_eq!(levels.iter().filter(|&&level| level == 10000).count(), 1);
            checked = true;
        }
        assert!(checked);
        drop(archive);
        let connection = Connection::open(&input).unwrap();
        let layer = read_layers(&connection)
            .unwrap()
            .into_iter()
            .find(|layer| layer.level == 10000)
            .unwrap();
        connection
            .execute(
                &format!("DELETE FROM {}", quote_identifier(&layer.table_name)),
                [],
            )
            .unwrap();
        drop(connection);
        update_tiles(&input, &path, 10000, 15, 15).unwrap();
        let mut archive = Archive::open(&path).unwrap();
        for id in archive.tiles.keys().copied().collect::<Vec<_>>() {
            let coord: TileCoord = TileId::new(id).unwrap().into();
            if coord.z() != 15 {
                continue;
            }
            for layer in decode_tile(&archive.raw_tile(id).unwrap()).unwrap().layers {
                assert!(layer.features.iter().all(|feature| !is_level(
                    feature,
                    &layer.keys,
                    &layer.values,
                    10000
                )));
            }
        }
        drop(archive);
        let previous = fs::read(&path).unwrap();
        assert!(update_tiles(&input, &path, 12345, 15, 15).is_err());
        assert!(update_tiles(&input, &path, 10000, 16, 15).is_err());
        assert!(update_tiles(&input, &path, 10000, 0, 15).is_err());
        assert_eq!(previous, fs::read(&path).unwrap());
    }
}
