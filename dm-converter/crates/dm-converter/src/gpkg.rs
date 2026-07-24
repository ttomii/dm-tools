// © TOMII, Tatsuru

use dm_parser::{Coordinate, Feature, Geometry, GeometryKind};
use rusqlite::{Connection, Transaction, params};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use thiserror::Error;

use crate::timing::{ProgressDisplay, timed};

#[derive(Debug, Error)]
pub enum WriterError {
    #[error("GeoPackage database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid geometry: {0}")]
    Geometry(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct LayerKey {
    pub dmcode: i64,
    pub kind: GeometryKind,
    pub plane_rectangular_zone: Option<u8>,
    pub map_level: Option<i64>,
}

impl LayerKey {
    pub fn from_feature(feature: &Feature) -> Self {
        Self {
            dmcode: feature.dmcode,
            kind: feature.geometry_kind,
            plane_rectangular_zone: feature.plane_rectangular_zone,
            map_level: feature.map_level,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct DecorationLayerKey {
    pub source: LayerKey,
    pub kind: GeometryKind,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecorationFeature {
    pub key: DecorationLayerKey,
    pub geometry: Geometry,
    pub src_layer: String,
    pub src_user_id: i64,
    pub src_dmfile: String,
    pub src_dmcode: i64,
    pub decoration: String,
    pub deco_index: i64,
    pub angle: Option<f64>,
}

#[derive(Debug, Clone)]
struct Layer {
    name: String,
    kind: GeometryKind,
    srs_id: i64,
    count: u64,
    bounds: Option<Envelope>,
    table_kind: TableKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TableKind {
    Base,
    Decoration,
}

struct PendingFeature {
    key: LayerKey,
    feature: Feature,
    user_id: i64,
}

struct PendingDecoration {
    key: DecorationLayerKey,
    feature: DecorationFeature,
    user_id: i64,
}

enum PendingWrite {
    Feature(Box<PendingFeature>),
    Decoration(Box<PendingDecoration>),
}

pub struct GeoPackageWriter {
    connection: Connection,
    layers: BTreeMap<LayerKey, Layer>,
    decoration_layers: BTreeMap<DecorationLayerKey, Layer>,
    pending: Vec<PendingWrite>,
    batch_size: usize,
    progress: bool,
}

impl GeoPackageWriter {
    pub fn create(
        path: &Path,
        layer_keys: &BTreeSet<LayerKey>,
        decoration_layer_keys: &BTreeSet<DecorationLayerKey>,
        batch_size: usize,
        progress: bool,
    ) -> Result<Self, WriterError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA page_size = 8192;
             PRAGMA cache_size = -1048576;
             PRAGMA temp_store = MEMORY;
             PRAGMA application_id = 1196444487;
             PRAGMA user_version = 10300;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE gpkg_spatial_ref_sys (
               srs_name TEXT NOT NULL,
               srs_id INTEGER NOT NULL PRIMARY KEY,
               organization TEXT NOT NULL,
               organization_coordsys_id INTEGER NOT NULL,
               definition TEXT NOT NULL,
               description TEXT
             );
             CREATE TABLE gpkg_contents (
               table_name TEXT NOT NULL PRIMARY KEY,
               data_type TEXT NOT NULL,
               identifier TEXT UNIQUE,
               description TEXT DEFAULT '',
               last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
               min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
               srs_id INTEGER,
               FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
             );
             CREATE TABLE gpkg_geometry_columns (
               table_name TEXT NOT NULL,
               column_name TEXT NOT NULL,
               geometry_type_name TEXT NOT NULL,
               srs_id INTEGER NOT NULL,
               z TINYINT NOT NULL,
               m TINYINT NOT NULL,
               PRIMARY KEY (table_name, column_name),
               FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
               FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
             );
             CREATE TABLE gpkg_extensions (
               table_name TEXT,
               column_name TEXT,
               extension_name TEXT NOT NULL,
               definition TEXT NOT NULL,
               scope TEXT NOT NULL,
               UNIQUE (table_name, column_name, extension_name)
             );",
        )?;
        connection.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES
             ('Undefined Cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined Cartesian coordinate reference system')",
            [],
        )?;
        connection.execute(
            "INSERT INTO gpkg_spatial_ref_sys VALUES
             ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system')",
            [],
        )?;
        let epsg_codes = layer_keys
            .iter()
            .filter_map(|key| key.plane_rectangular_zone.map(zone_to_epsg))
            .collect::<BTreeSet<_>>();
        for code in epsg_codes {
            connection.execute(
                "INSERT INTO gpkg_spatial_ref_sys
                 (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
                 VALUES (?1, ?1, 'EPSG', ?1, 'undefined', ?2)",
                params![code, format!("EPSG:{code}")],
            )?;
        }
        let mut layers = BTreeMap::new();
        for key in layer_keys {
            let name = layer_name(key);
            let srs_id = key.plane_rectangular_zone.map(zone_to_epsg).unwrap_or(-1);
            create_base_layer(&connection, &name, key.kind, srs_id)?;
            layers.insert(
                key.clone(),
                Layer {
                    name,
                    kind: key.kind,
                    srs_id,
                    count: 0,
                    bounds: None,
                    table_kind: TableKind::Base,
                },
            );
        }
        let mut decoration_layers = BTreeMap::new();
        for key in decoration_layer_keys {
            let name = decoration_layer_name(key);
            let srs_id = key
                .source
                .plane_rectangular_zone
                .map(zone_to_epsg)
                .unwrap_or(-1);
            create_decoration_layer(&connection, &name, key.kind, srs_id)?;
            decoration_layers.insert(
                key.clone(),
                Layer {
                    name,
                    kind: key.kind,
                    srs_id,
                    count: 0,
                    bounds: None,
                    table_kind: TableKind::Decoration,
                },
            );
        }
        connection.set_prepared_statement_cache_capacity(
            (layer_keys.len() + decoration_layer_keys.len())
                .saturating_mul(2)
                .saturating_add(8),
        );
        Ok(Self {
            connection,
            layers,
            decoration_layers,
            pending: Vec::with_capacity(batch_size),
            batch_size,
            progress,
        })
    }

    fn flush(&mut self) -> Result<(), WriterError> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let transaction = self.connection.transaction()?;
        for pending in self.pending.drain(..) {
            match pending {
                PendingWrite::Feature(pending) => {
                    let layer = self.layers.get_mut(&pending.key).ok_or_else(|| {
                        WriterError::Geometry(format!(
                            "input changed during conversion: undiscovered layer {:?}",
                            pending.key
                        ))
                    })?;
                    insert_feature(&transaction, layer, &pending.feature, pending.user_id)?;
                }
                PendingWrite::Decoration(pending) => {
                    let layer = self
                        .decoration_layers
                        .get_mut(&pending.key)
                        .ok_or_else(|| {
                            WriterError::Geometry(format!(
                                "input changed during conversion: undiscovered decoration layer {:?}",
                                pending.key
                            ))
                        })?;
                    insert_decoration(&transaction, layer, &pending.feature, pending.user_id)?;
                }
            }
        }
        transaction.commit()?;
        Ok(())
    }

    fn finalize_indexes(&mut self) -> Result<(), WriterError> {
        let layer_count = self.layers.len() + self.decoration_layers.len();
        timed("finalizing GeoPackage layers", || {
            let mut progress = ProgressDisplay::new(self.progress);
            for (index, layer) in self
                .layers
                .values()
                .chain(self.decoration_layers.values())
                .enumerate()
            {
                let table = quote_identifier(&layer.name);
                let name_literal = quote_string_literal(&layer.name);
                let rtree_name = format!("rtree_{}_geom", layer.name);
                let rtree = quote_identifier(&rtree_name);
                let trigger_insert = quote_identifier(&format!("{rtree_name}_insert"));
                let trigger_update1 = quote_identifier(&format!("{rtree_name}_update1"));
                let trigger_update2 = quote_identifier(&format!("{rtree_name}_update2"));
                let trigger_update3 = quote_identifier(&format!("{rtree_name}_update3"));
                let trigger_update4 = quote_identifier(&format!("{rtree_name}_update4"));
                let trigger_delete = quote_identifier(&format!("{rtree_name}_delete"));
                let table_indexes = match layer.table_kind {
                    TableKind::Base => {
                        let dmcode_index = quote_identifier(&format!("{}_dmcode_idx", layer.name));
                        let dmfile_index = quote_identifier(&format!("{}_dmfile_idx", layer.name));
                        let user_id_index =
                            quote_identifier(&format!("{}_user_id_idx", layer.name));
                        format!(
                            "CREATE INDEX {dmcode_index} ON {table}(DMCODE);
                         CREATE INDEX {dmfile_index} ON {table}(DMFILE);
                         CREATE UNIQUE INDEX {user_id_index} ON {table}(USER_ID);"
                        )
                    }
                    TableKind::Decoration => {
                        let src_dmcode_index =
                            quote_identifier(&format!("{}_src_dmcode_idx", layer.name));
                        let src_dmfile_index =
                            quote_identifier(&format!("{}_src_dmfile_idx", layer.name));
                        let src_user_id_index =
                            quote_identifier(&format!("{}_src_user_id_idx", layer.name));
                        let decoration_index =
                            quote_identifier(&format!("{}_decoration_idx", layer.name));
                        format!(
                            "CREATE INDEX {src_dmcode_index} ON {table}(SRC_DMCODE);
                         CREATE INDEX {src_dmfile_index} ON {table}(SRC_DMFILE);
                         CREATE INDEX {src_user_id_index} ON {table}(SRC_USER_ID);
                         CREATE INDEX {decoration_index} ON {table}(DECORATION);"
                        )
                    }
                };
                self.connection.execute_batch(&format!(
                    "{table_indexes}
                 INSERT INTO gpkg_extensions
                   (table_name, column_name, extension_name, definition, scope)
                 VALUES
                   ({name_literal}, 'geom', 'gpkg_rtree_index',
                    'http://www.geopackage.org/spec/#extension_rtree', 'write-only');
                 CREATE TRIGGER {trigger_insert} AFTER INSERT ON {table}
                   WHEN (NEW.geom NOT NULL AND NOT ST_IsEmpty(NEW.geom))
                   BEGIN
                     INSERT OR REPLACE INTO {rtree}
                     VALUES (NEW.fid, ST_MinX(NEW.geom), ST_MaxX(NEW.geom),
                             ST_MinY(NEW.geom), ST_MaxY(NEW.geom));
                   END;
                 CREATE TRIGGER {trigger_update1} AFTER UPDATE OF geom ON {table}
                   WHEN OLD.fid = NEW.fid AND NEW.geom NOTNULL
                        AND NOT ST_IsEmpty(NEW.geom)
                   BEGIN
                     INSERT OR REPLACE INTO {rtree}
                     VALUES (NEW.fid, ST_MinX(NEW.geom), ST_MaxX(NEW.geom),
                             ST_MinY(NEW.geom), ST_MaxY(NEW.geom));
                   END;
                 CREATE TRIGGER {trigger_update2} AFTER UPDATE OF geom ON {table}
                   WHEN OLD.fid = NEW.fid AND
                        (NEW.geom ISNULL OR ST_IsEmpty(NEW.geom))
                   BEGIN
                     DELETE FROM {rtree} WHERE id = OLD.fid;
                   END;
                 CREATE TRIGGER {trigger_update3} AFTER UPDATE OF fid ON {table}
                   WHEN OLD.fid != NEW.fid AND NEW.geom NOTNULL
                        AND NOT ST_IsEmpty(NEW.geom)
                   BEGIN
                     DELETE FROM {rtree} WHERE id = OLD.fid;
                     INSERT OR REPLACE INTO {rtree}
                     VALUES (NEW.fid, ST_MinX(NEW.geom), ST_MaxX(NEW.geom),
                             ST_MinY(NEW.geom), ST_MaxY(NEW.geom));
                   END;
                 CREATE TRIGGER {trigger_update4} AFTER UPDATE ON {table}
                   WHEN OLD.fid != NEW.fid AND
                        (NEW.geom ISNULL OR ST_IsEmpty(NEW.geom))
                   BEGIN
                     DELETE FROM {rtree} WHERE id IN (OLD.fid, NEW.fid);
                   END;
                 CREATE TRIGGER {trigger_delete} AFTER DELETE ON {table}
                   WHEN OLD.geom NOT NULL
                   BEGIN
                     DELETE FROM {rtree} WHERE id = OLD.fid;
                   END;"
                ))?;
                self.connection.execute(
                    "UPDATE gpkg_contents SET
                       min_x = ?1,
                       min_y = ?2,
                       max_x = ?3,
                       max_y = ?4,
                       last_change = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     WHERE table_name = ?5",
                    params![
                        layer.bounds.map(|bounds| bounds.min_x),
                        layer.bounds.map(|bounds| bounds.min_y),
                        layer.bounds.map(|bounds| bounds.max_x),
                        layer.bounds.map(|bounds| bounds.max_y),
                        &layer.name,
                    ],
                )?;
                progress.progress(index + 1, layer_count, "finalize layer");
            }
            Ok::<(), WriterError>(())
        })?;

        timed("optimizing GeoPackage", || {
            self.connection.execute_batch("PRAGMA optimize;")
        })?;

        timed("checkpointing GeoPackage WAL", || {
            self.connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        })?;
        Ok(())
    }
}

impl GeoPackageWriter {
    pub fn write(&mut self, feature: Feature, user_id: i64) -> Result<(), WriterError> {
        let key = LayerKey {
            dmcode: feature.dmcode,
            kind: feature.geometry_kind,
            plane_rectangular_zone: feature.plane_rectangular_zone,
            map_level: feature.map_level,
        };
        self.pending
            .push(PendingWrite::Feature(Box::new(PendingFeature {
                key,
                feature,
                user_id,
            })));
        if self.pending.len() >= self.batch_size {
            self.flush()?;
        }
        Ok(())
    }

    pub fn finish(&mut self) -> Result<BTreeMap<String, u64>, WriterError> {
        timed("flushing remaining GeoPackage features", || self.flush())?;

        self.finalize_indexes()?;
        Ok(self
            .layers
            .values()
            .chain(self.decoration_layers.values())
            .map(|layer| (layer.name.clone(), layer.count))
            .collect())
    }

    pub fn write_decoration(
        &mut self,
        feature: DecorationFeature,
        user_id: i64,
    ) -> Result<(), WriterError> {
        self.pending
            .push(PendingWrite::Decoration(Box::new(PendingDecoration {
                key: feature.key.clone(),
                feature,
                user_id,
            })));
        if self.pending.len() >= self.batch_size {
            self.flush()?;
        }
        Ok(())
    }
}

fn create_base_layer(
    connection: &Connection,
    name: &str,
    kind: GeometryKind,
    srs_id: i64,
) -> Result<(), WriterError> {
    let table = quote_identifier(name);
    let rtree = quote_identifier(&format!("rtree_{name}_geom"));
    let extra_columns = match kind {
        GeometryKind::Text => {
            ", ANGLE REAL, SIZE REAL, CHARSPACING REAL, LINENO INTEGER, VERTICAL INTEGER, TEXT TEXT"
        }
        GeometryKind::Point => ", ANGLE REAL",
        GeometryKind::Polygon | GeometryKind::Line => "",
    };
    connection.execute_batch(&format!(
        "CREATE TABLE {table} (
           fid INTEGER PRIMARY KEY AUTOINCREMENT,
           geom BLOB NOT NULL,
           USER_ID INTEGER NOT NULL,
           DMCODE INTEGER,
           LEVEL INTEGER,
           DMFIGTYPE INTEGER,
           DMMOVE INTEGER,
           DMSKIP INTEGER,
           DMATTR INTEGER,
           DMPREC INTEGER,
           DMYYMM INTEGER,
           DMREGION INTEGER,
           DMINFO INTEGER,
           DMELEMID INTEGER,
           DMATTRKIND INTEGER,
           DMUPYYMM INTEGER,
           DMDELYYMM INTEGER,
           DMATTRDATA TEXT,
           DMFILE TEXT NOT NULL
           {extra_columns}
         );
         CREATE VIRTUAL TABLE {rtree} USING rtree(id, minx, maxx, miny, maxy);"
    ))?;
    connection.execute(
        "INSERT INTO gpkg_contents
         (table_name, data_type, identifier, description, srs_id)
         VALUES (?1, 'features', ?1, '', ?2)",
        params![name, srs_id],
    )?;
    connection.execute(
        "INSERT INTO gpkg_geometry_columns
         (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?1, 'geom', ?2, ?3, 0, 0)",
        params![name, geometry_type_name(kind), srs_id],
    )?;
    Ok(())
}

fn create_decoration_layer(
    connection: &Connection,
    name: &str,
    kind: GeometryKind,
    srs_id: i64,
) -> Result<(), WriterError> {
    let table = quote_identifier(name);
    let rtree = quote_identifier(&format!("rtree_{name}_geom"));
    let angle_column = if kind == GeometryKind::Point {
        ", ANGLE REAL"
    } else {
        ""
    };
    connection.execute_batch(&format!(
        "CREATE TABLE {table} (
           fid INTEGER PRIMARY KEY AUTOINCREMENT,
           geom BLOB NOT NULL,
           USER_ID INTEGER NOT NULL,
           SRC_LAYER TEXT NOT NULL,
           SRC_USER_ID INTEGER NOT NULL,
           SRC_DMFILE TEXT NOT NULL,
           SRC_DMCODE INTEGER NOT NULL,
           DECORATION TEXT NOT NULL,
           DECO_INDEX INTEGER NOT NULL
           {angle_column}
         );
         CREATE VIRTUAL TABLE {rtree} USING rtree(id, minx, maxx, miny, maxy);"
    ))?;
    connection.execute(
        "INSERT INTO gpkg_contents
         (table_name, data_type, identifier, description, srs_id)
         VALUES (?1, 'features', ?1, '', ?2)",
        params![name, srs_id],
    )?;
    connection.execute(
        "INSERT INTO gpkg_geometry_columns
         (table_name, column_name, geometry_type_name, srs_id, z, m)
         VALUES (?1, 'geom', ?2, ?3, 0, 0)",
        params![name, geometry_type_name(kind), srs_id],
    )?;
    Ok(())
}

fn insert_feature(
    transaction: &Transaction<'_>,
    layer: &mut Layer,
    feature: &Feature,
    user_id: i64,
) -> Result<(), WriterError> {
    let points = output_points(&feature.geometry)?;
    let envelope = Envelope::from_points(&points)
        .ok_or_else(|| WriterError::Geometry("empty geometry".to_string()))?;
    let blob = geometry_blob(layer.kind, &points, envelope, layer.srs_id);
    let table = quote_identifier(&layer.name);
    let extra_names = match layer.kind {
        GeometryKind::Text => ", ANGLE, SIZE, CHARSPACING, LINENO, VERTICAL, TEXT",
        GeometryKind::Point => ", ANGLE",
        GeometryKind::Polygon | GeometryKind::Line => "",
    };
    let extra_values = match layer.kind {
        GeometryKind::Text => ", ?19, ?20, ?21, ?22, ?23, ?24",
        GeometryKind::Point => ", ?19",
        GeometryKind::Polygon | GeometryKind::Line => "",
    };
    let sql = format!(
        "INSERT INTO {table}
         (geom, USER_ID, DMCODE, LEVEL, DMFIGTYPE, DMMOVE, DMSKIP, DMATTR, DMPREC, DMYYMM,
          DMREGION, DMINFO, DMELEMID, DMATTRKIND, DMUPYYMM, DMDELYYMM, DMATTRDATA,
          DMFILE{extra_names})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18{extra_values})"
    );
    let mut statement = transaction.prepare_cached(&sql)?;
    match layer.kind {
        GeometryKind::Text => statement.execute(params![
            blob,
            user_id,
            feature.dmcode,
            feature.map_level,
            feature.attributes.dmfigtype,
            feature.attributes.dmmove,
            feature.attributes.dmskip,
            feature.attributes.dmattr,
            feature.attributes.dmprec,
            feature.attributes.dmyymm,
            feature.attributes.dmregion,
            feature.attributes.dminfo,
            feature.attributes.dmelemid,
            feature.attributes.dmattrkind,
            feature.attributes.dmupyymm,
            feature.attributes.dmdelyymm,
            feature.attributes.dmattrdata,
            feature.source_file,
            feature.attributes.angle,
            feature.attributes.size,
            feature.attributes.char_spacing,
            feature.attributes.line_no,
            feature.attributes.vertical,
            feature.attributes.text,
        ])?,
        GeometryKind::Point => statement.execute(params![
            blob,
            user_id,
            feature.dmcode,
            feature.map_level,
            feature.attributes.dmfigtype,
            feature.attributes.dmmove,
            feature.attributes.dmskip,
            feature.attributes.dmattr,
            feature.attributes.dmprec,
            feature.attributes.dmyymm,
            feature.attributes.dmregion,
            feature.attributes.dminfo,
            feature.attributes.dmelemid,
            feature.attributes.dmattrkind,
            feature.attributes.dmupyymm,
            feature.attributes.dmdelyymm,
            feature.attributes.dmattrdata,
            feature.source_file,
            feature.attributes.angle,
        ])?,
        GeometryKind::Polygon | GeometryKind::Line => statement.execute(params![
            blob,
            user_id,
            feature.dmcode,
            feature.map_level,
            feature.attributes.dmfigtype,
            feature.attributes.dmmove,
            feature.attributes.dmskip,
            feature.attributes.dmattr,
            feature.attributes.dmprec,
            feature.attributes.dmyymm,
            feature.attributes.dmregion,
            feature.attributes.dminfo,
            feature.attributes.dmelemid,
            feature.attributes.dmattrkind,
            feature.attributes.dmupyymm,
            feature.attributes.dmdelyymm,
            feature.attributes.dmattrdata,
            feature.source_file,
        ])?,
    };
    let fid = transaction.last_insert_rowid();
    let rtree_sql = format!(
        "INSERT INTO {} VALUES (?1, ?2, ?3, ?4, ?5)",
        quote_identifier(&format!("rtree_{}_geom", layer.name))
    );
    transaction.prepare_cached(&rtree_sql)?.execute(params![
        fid,
        envelope.min_x,
        envelope.max_x,
        envelope.min_y,
        envelope.max_y
    ])?;
    layer.count += 1;
    layer.record_bounds(envelope);
    Ok(())
}

fn insert_decoration(
    transaction: &Transaction<'_>,
    layer: &mut Layer,
    feature: &DecorationFeature,
    user_id: i64,
) -> Result<(), WriterError> {
    let points = output_points(&feature.geometry)?;
    let envelope = Envelope::from_points(&points)
        .ok_or_else(|| WriterError::Geometry("empty geometry".to_string()))?;
    let blob = geometry_blob(layer.kind, &points, envelope, layer.srs_id);
    let table = quote_identifier(&layer.name);
    let (extra_name, extra_value) = if layer.kind == GeometryKind::Point {
        (", ANGLE", ", ?9")
    } else {
        ("", "")
    };
    let sql = format!(
        "INSERT INTO {table}
         (geom, USER_ID, SRC_LAYER, SRC_USER_ID, SRC_DMFILE, SRC_DMCODE, DECORATION, DECO_INDEX{extra_name})
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8{extra_value})"
    );
    let mut statement = transaction.prepare_cached(&sql)?;
    if layer.kind == GeometryKind::Point {
        statement.execute(params![
            blob,
            user_id,
            feature.src_layer,
            feature.src_user_id,
            feature.src_dmfile,
            feature.src_dmcode,
            feature.decoration,
            feature.deco_index,
            feature.angle,
        ])?;
    } else {
        statement.execute(params![
            blob,
            user_id,
            feature.src_layer,
            feature.src_user_id,
            feature.src_dmfile,
            feature.src_dmcode,
            feature.decoration,
            feature.deco_index,
        ])?;
    }
    let fid = transaction.last_insert_rowid();
    let rtree_sql = format!(
        "INSERT INTO {} VALUES (?1, ?2, ?3, ?4, ?5)",
        quote_identifier(&format!("rtree_{}_geom", layer.name))
    );
    transaction.prepare_cached(&rtree_sql)?.execute(params![
        fid,
        envelope.min_x,
        envelope.max_x,
        envelope.min_y,
        envelope.max_y
    ])?;
    layer.count += 1;
    layer.record_bounds(envelope);
    Ok(())
}

pub fn layer_name(key: &LayerKey) -> String {
    format!(
        "dm_{}_{}_{}_{}",
        key.dmcode,
        key.kind.as_str(),
        zone_name(key.plane_rectangular_zone),
        level_name(key.map_level)
    )
}

pub fn decoration_layer_name(key: &DecorationLayerKey) -> String {
    format!("{}_deco_{}", layer_name(&key.source), key.kind.as_str())
}

fn zone_name(zone: Option<u8>) -> String {
    zone.map_or_else(|| "unknown".to_string(), |zone| format!("{zone:02}"))
}

fn level_name(level: Option<i64>) -> String {
    level.map_or_else(|| "unknown".to_string(), |level| level.to_string())
}

fn output_points(geometry: &Geometry) -> Result<Vec<Coordinate>, WriterError> {
    match geometry {
        Geometry::Point(point) | Geometry::TextPoint(point) => Ok(vec![*point]),
        Geometry::LineString(points) | Geometry::Polygon(points) => Ok(points.clone()),
        Geometry::Circle { center, radius, .. } => {
            let mut points = Vec::with_capacity(73);
            for step in 0..=72 {
                let angle = (step as f64 * 5.0).to_radians();
                points.push(Coordinate {
                    x: center.x + radius * angle.cos(),
                    y: center.y + radius * angle.sin(),
                    z: None,
                });
            }
            points[72] = points[0];
            Ok(points)
        }
        Geometry::Arc {
            center,
            radius,
            start_angle,
            end_angle,
            clockwise,
            ..
        } => {
            let sweep = arc_sweep(*start_angle, *end_angle, *clockwise);
            let segments = (sweep.abs() / 5.0).ceil().max(1.0) as usize;
            let mut points = Vec::with_capacity(segments + 1);
            for step in 0..=segments {
                let angle = start_angle + sweep * step as f64 / segments as f64;
                let radians = angle.to_radians();
                points.push(Coordinate {
                    x: center.x + radius * radians.cos(),
                    y: center.y + radius * radians.sin(),
                    z: None,
                });
            }
            Ok(points)
        }
    }
}

fn arc_sweep(start: f64, end: f64, clockwise: bool) -> f64 {
    let mut sweep = end - start;
    if clockwise {
        while sweep > 0.0 {
            sweep -= 360.0;
        }
    } else {
        while sweep < 0.0 {
            sweep += 360.0;
        }
    }
    sweep
}

#[derive(Debug, Clone, Copy)]
struct Envelope {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

impl Envelope {
    fn from_points(points: &[Coordinate]) -> Option<Self> {
        let first = points.first()?;
        let mut envelope = Self {
            min_x: first.x,
            max_x: first.x,
            min_y: first.y,
            max_y: first.y,
        };
        for point in &points[1..] {
            envelope.min_x = envelope.min_x.min(point.x);
            envelope.max_x = envelope.max_x.max(point.x);
            envelope.min_y = envelope.min_y.min(point.y);
            envelope.max_y = envelope.max_y.max(point.y);
        }
        Some(envelope)
    }

    fn union(self, other: Self) -> Self {
        Self {
            min_x: self.min_x.min(other.min_x),
            max_x: self.max_x.max(other.max_x),
            min_y: self.min_y.min(other.min_y),
            max_y: self.max_y.max(other.max_y),
        }
    }
}

impl Layer {
    fn record_bounds(&mut self, envelope: Envelope) {
        self.bounds = Some(
            self.bounds
                .map_or(envelope, |bounds| bounds.union(envelope)),
        );
    }
}

fn geometry_blob(
    kind: GeometryKind,
    points: &[Coordinate],
    envelope: Envelope,
    srs_id: i64,
) -> Vec<u8> {
    let mut blob = Vec::with_capacity(48 + points.len() * 16);
    blob.extend_from_slice(b"GP");
    blob.push(0);
    blob.push(0b0000_0011);
    blob.extend_from_slice(&(srs_id as i32).to_le_bytes());
    for value in [
        envelope.min_x,
        envelope.max_x,
        envelope.min_y,
        envelope.max_y,
    ] {
        blob.extend_from_slice(&value.to_le_bytes());
    }
    blob.push(1);
    match kind {
        GeometryKind::Point | GeometryKind::Text => {
            blob.extend_from_slice(&1_u32.to_le_bytes());
            blob.extend_from_slice(&points[0].x.to_le_bytes());
            blob.extend_from_slice(&points[0].y.to_le_bytes());
        }
        GeometryKind::Line => {
            blob.extend_from_slice(&2_u32.to_le_bytes());
            blob.extend_from_slice(&(points.len() as u32).to_le_bytes());
            append_points(&mut blob, points);
        }
        GeometryKind::Polygon => {
            blob.extend_from_slice(&3_u32.to_le_bytes());
            blob.extend_from_slice(&1_u32.to_le_bytes());
            blob.extend_from_slice(&(points.len() as u32).to_le_bytes());
            append_points(&mut blob, points);
        }
    }
    blob
}

fn append_points(blob: &mut Vec<u8>, points: &[Coordinate]) {
    for point in points {
        blob.extend_from_slice(&point.x.to_le_bytes());
        blob.extend_from_slice(&point.y.to_le_bytes());
    }
}

fn geometry_type_name(kind: GeometryKind) -> &'static str {
    match kind {
        GeometryKind::Polygon => "POLYGON",
        GeometryKind::Line => "LINESTRING",
        GeometryKind::Point | GeometryKind::Text => "POINT",
    }
}

fn zone_to_epsg(zone: u8) -> i64 {
    6668 + i64::from(zone)
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn quote_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use dm_parser::Attributes;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    type StoredDmAttributes = (
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<String>,
    );

    #[test]
    fn arc_sweep_passes_through_expected_direction() {
        assert_eq!(arc_sweep(10.0, 80.0, false), 70.0);
        assert_eq!(arc_sweep(10.0, 350.0, true), -20.0);
    }

    #[test]
    fn circle_uses_five_degree_segments() {
        let points = output_points(&Geometry::Circle {
            center: Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            },
            radius: 10.0,
            source: [Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            }; 3],
        })
        .unwrap();
        assert_eq!(points.len(), 73);
        assert_eq!(points.first(), points.last());
    }

    #[test]
    fn creates_queryable_geopackage_layer_and_indexes() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "dm-converter-test-{}-{unique}.gpkg",
            std::process::id()
        ));
        let key = LayerKey {
            dmcode: 2100,
            kind: GeometryKind::Line,
            plane_rectangular_zone: Some(8),
            map_level: Some(2500),
        };
        let mut writer =
            GeoPackageWriter::create(&path, &BTreeSet::from([key]), &BTreeSet::new(), 1, false)
                .unwrap();
        let attributes = Attributes {
            dmregion: Some(3),
            dminfo: Some(42),
            dmelemid: Some(123),
            dmattrkind: Some(9),
            dmupyymm: Some(1401),
            dmdelyymm: Some(1502),
            dmattrdata: Some("OWNER=ABC".to_string()),
            ..Attributes::default()
        };
        writer
            .write(
                Feature {
                    source_file: "sample.dm".to_string(),
                    source_line: 1,
                    plane_rectangular_zone: Some(8),
                    map_level: Some(2500),
                    dmcode: 2100,
                    geometry_kind: GeometryKind::Line,
                    geometry: Geometry::LineString(vec![
                        Coordinate {
                            x: 1.0,
                            y: 2.0,
                            z: None,
                        },
                        Coordinate {
                            x: 3.0,
                            y: 4.0,
                            z: None,
                        },
                    ]),
                    attributes,
                    warnings: Vec::new(),
                },
                1,
            )
            .unwrap();
        let counts = writer.finish().unwrap();
        assert_eq!(counts.get("dm_2100_line_08_2500"), Some(&1));
        drop(writer);

        let connection = Connection::open(&path).unwrap();
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM dm_2100_line_08_2500", [], |row| {
                row.get(0)
            })
            .unwrap();
        let rtree_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM rtree_dm_2100_line_08_2500_geom",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let srs: String = connection
            .query_row(
                "SELECT organization FROM gpkg_spatial_ref_sys WHERE srs_id=6676",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let attrs: StoredDmAttributes = connection
            .query_row(
                "SELECT LEVEL, DMREGION, DMINFO, DMELEMID, DMATTRKIND,
                        DMUPYYMM, DMDELYYMM, DMATTRDATA
                 FROM dm_2100_line_08_2500",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(rtree_count, 1);
        assert_eq!(srs, "EPSG");
        assert_eq!(
            attrs,
            (
                Some(2500),
                Some(3),
                Some(42),
                Some(123),
                Some(9),
                Some(1401),
                Some(1502),
                Some("OWNER=ABC".to_string()),
            )
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn separates_layers_with_different_coordinate_zones() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "dm-converter-zones-test-{}-{unique}.gpkg",
            std::process::id()
        ));
        let keys = BTreeSet::from([
            LayerKey {
                dmcode: 2100,
                kind: GeometryKind::Line,
                plane_rectangular_zone: Some(8),
                map_level: Some(2500),
            },
            LayerKey {
                dmcode: 2100,
                kind: GeometryKind::Line,
                plane_rectangular_zone: Some(9),
                map_level: Some(2500),
            },
        ]);
        let writer = GeoPackageWriter::create(&path, &keys, &BTreeSet::new(), 10, false).unwrap();
        assert!(
            writer
                .layers
                .values()
                .any(|layer| { layer.name == "dm_2100_line_08_2500" && layer.srs_id == 6676 })
        );
        assert!(
            writer
                .layers
                .values()
                .any(|layer| { layer.name == "dm_2100_line_09_2500" && layer.srs_id == 6677 })
        );
        drop(writer);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn separates_layers_with_different_map_levels() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "dm-converter-levels-test-{}-{unique}.gpkg",
            std::process::id()
        ));
        let keys = BTreeSet::from([
            LayerKey {
                dmcode: 2100,
                kind: GeometryKind::Line,
                plane_rectangular_zone: Some(8),
                map_level: Some(2500),
            },
            LayerKey {
                dmcode: 2100,
                kind: GeometryKind::Line,
                plane_rectangular_zone: Some(8),
                map_level: Some(10000),
            },
        ]);
        let writer = GeoPackageWriter::create(&path, &keys, &BTreeSet::new(), 10, false).unwrap();
        assert!(
            writer
                .layers
                .values()
                .any(|layer| layer.name == "dm_2100_line_08_2500")
        );
        assert!(
            writer
                .layers
                .values()
                .any(|layer| layer.name == "dm_2100_line_08_10000")
        );
        drop(writer);
        fs::remove_file(path).unwrap();
    }
}
