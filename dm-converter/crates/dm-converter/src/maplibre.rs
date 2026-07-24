// © TOMII, Tatsuru

use dm_parser::{Coordinate, Feature, Geometry, GeometryKind};
use pmtiles::{PmTilesWriter, TileCoord, TileType};
use proj4rs::{Proj, transform};
use prost::Message;
use rayon::prelude::*;
use rusqlite::{Connection, Row};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

use crate::timing::{ProgressDisplay, timed};

const MIN_ZOOM: u8 = 14;
const MAX_ZOOM: u8 = 18;
const EXTENT: u32 = 4096;
const BUFFER: i32 = 64;
const SIMPLIFY_TOLERANCE: f64 = 4.0;
const WEB_MERCATOR_HALF: f64 = 20_037_508.342_789_244;
#[derive(Debug, Error)]
pub enum MapLibreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("coordinate transform failed: {0}")]
    Projection(String),
    #[error("PMTiles error: {0}")]
    PmTiles(#[from] pmtiles::PmtError),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("GeoPackage error: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("MapLibre asset error: {0}")]
    Asset(String),
    #[error("unsupported GeoPackage layer {layer}: {reason}")]
    UnsupportedLayer { layer: String, reason: String },
    #[error("no MapLibre features remain after validation")]
    Empty,
}

#[derive(Debug, Clone)]
struct MapDecoration {
    src_layer: String,
    src_user_id: i64,
    src_dmfile: String,
    src_dmcode: i64,
    decoration: String,
    deco_index: i64,
}

#[derive(Debug, Default)]
pub struct MapLibreSummary {
    pub features: u64,
    pub skipped: u64,
    pub warnings: Vec<String>,
    pub layers: u64,
    pub tiles: u64,
    pub bounds: [f64; 4],
    pub levels: BTreeSet<i64>,
    pub source_layers: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct ProjectedFeature {
    feature: Feature,
    user_id: i64,
    points: Vec<Coordinate>,
    decoration: Option<MapDecoration>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct TileKey {
    z: u8,
    x: u32,
    y: u32,
}

#[derive(Debug, Clone)]
struct GpkgLayer {
    table_name: String,
    kind: GeometryKind,
    zone: u8,
    level: i64,
    decoration: bool,
    bounds: [f64; 4],
}

struct Projector {
    local: BTreeMap<u8, Proj>,
    web_mercator: Proj,
}

impl Projector {
    fn new(layers: &[GpkgLayer]) -> Result<Self, MapLibreError> {
        let web_mercator = Proj::from_proj_string("+proj=webmerc +datum=WGS84 +units=m")
            .map_err(|error| MapLibreError::Projection(error.to_string()))?;
        let local = layers
            .iter()
            .map(|layer| layer.zone)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|zone| {
                let (lat_0, lon_0) = zone_origin(zone)?;
                let projection = Proj::from_proj_string(&format!(
                    "+proj=tmerc +lat_0={lat_0} +lon_0={lon_0} +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m"
                ))
                .map_err(|error| MapLibreError::Projection(error.to_string()))?;
                Ok((zone, projection))
            })
            .collect::<Result<_, MapLibreError>>()?;
        Ok(Self {
            local,
            web_mercator,
        })
    }

    fn project(&self, zone: u8, points: &[Coordinate]) -> Result<Vec<Coordinate>, MapLibreError> {
        transform_points(self.local(zone)?, &self.web_mercator, points)
    }

    fn local(&self, zone: u8) -> Result<&Proj, MapLibreError> {
        self.local
            .get(&zone)
            .ok_or_else(|| MapLibreError::Projection(format!("unsupported zone {zone}")))
    }
}

struct TileSource<'a> {
    connection: &'a Connection,
    layers: &'a [GpkgLayer],
    projector: &'a Projector,
}

type TileLayers = BTreeMap<String, Vec<Arc<ProjectedFeature>>>;

pub fn write_from_gpkg(
    output: &Path,
    layer_name: &str,
    gpkg: &Path,
    progress: bool,
) -> Result<MapLibreSummary, MapLibreError> {
    let connection = timed("opening GeoPackage", || Connection::open(gpkg))?;
    let layers = timed("reading GeoPackage layers", || read_layers(&connection))?;
    if layers.is_empty() {
        return Err(MapLibreError::Empty);
    }
    connection.set_prepared_statement_cache_capacity(layers.len().saturating_add(8));
    let projector = Projector::new(&layers)?;
    fs::create_dir_all(output)?;
    let mut summary = timed("summarizing GeoPackage features", || {
        summarize_gpkg(&connection, &layers, &projector)
    })?;
    let keys = timed("collecting PMTiles tile candidates", || {
        tile_keys(&layers, &projector)
    })?;
    let tile_source = TileSource {
        connection: &connection,
        layers: &layers,
        projector: &projector,
    };
    summary.tiles = timed("writing PMTiles tiles", || {
        write_pmtiles(output, layer_name, &summary, &tile_source, keys, progress)
    })?;
    timed("writing PMTiles manifest", || {
        write_manifest(output, layer_name, &summary)
    })?;
    Ok(summary)
}

fn summarize_gpkg(
    connection: &Connection,
    layers: &[GpkgLayer],
    projector: &Projector,
) -> Result<MapLibreSummary, MapLibreError> {
    let mut summary = MapLibreSummary {
        bounds: [180.0, 90.0, -180.0, -90.0],
        ..MapLibreSummary::default()
    };
    let mut source_layers = BTreeSet::new();
    for layer in layers {
        summary.levels.insert(layer.level);
        let count: u64 = connection.query_row(
            &format!(
                "SELECT COUNT(*) FROM {}",
                quote_identifier(&layer.table_name)
            ),
            [],
            |row| {
                let count = row.get::<_, i64>(0)?;
                u64::try_from(count).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(0, count))
            },
        )?;
        summary.features += count;
        let corners = [
            Coordinate {
                x: layer.bounds[0],
                y: layer.bounds[1],
                z: None,
            },
            Coordinate {
                x: layer.bounds[0],
                y: layer.bounds[3],
                z: None,
            },
            Coordinate {
                x: layer.bounds[2],
                y: layer.bounds[1],
                z: None,
            },
            Coordinate {
                x: layer.bounds[2],
                y: layer.bounds[3],
                z: None,
            },
        ];
        for point in projector.project(layer.zone, &corners)? {
            let (lon, lat) = mercator_to_lon_lat(point);
            summary.bounds[0] = summary.bounds[0].min(lon);
            summary.bounds[1] = summary.bounds[1].min(lat);
            summary.bounds[2] = summary.bounds[2].max(lon);
            summary.bounds[3] = summary.bounds[3].max(lat);
        }
        source_layers.insert(source_layer_from_table(layer));
    }
    summary.layers = source_layers.len() as u64;
    summary.source_layers = source_layers;
    Ok(summary)
}

fn read_layers(connection: &Connection) -> Result<Vec<GpkgLayer>, MapLibreError> {
    let mut statement = connection.prepare(
        "SELECT c.table_name, g.geometry_type_name, g.srs_id,
                c.min_x, c.min_y, c.max_x, c.max_y
         FROM gpkg_contents c
         JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
         WHERE c.data_type = 'features'
         ORDER BY c.table_name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            [
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, f64>(6)?,
            ],
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(table_name, geometry_type, srs_id, bounds)| {
            let parts = table_name.split('_').collect::<Vec<_>>();
            let decoration = table_name.contains("_deco_");
            let kind_name = if decoration {
                parts.last().copied().unwrap_or_default()
            } else {
                parts.get(2).copied().unwrap_or_default()
            };
            let kind = match kind_name {
                "polygon" => GeometryKind::Polygon,
                "line" => GeometryKind::Line,
                "point" => GeometryKind::Point,
                "text" => GeometryKind::Text,
                _ => {
                    return Err(MapLibreError::UnsupportedLayer {
                        layer: table_name,
                        reason: format!("unsupported geometry type {geometry_type}"),
                    });
                }
            };
            let zone = zone_from_srs_id(srs_id).ok_or_else(|| MapLibreError::UnsupportedLayer {
                layer: table_name.clone(),
                reason: format!(
                    "SRS ID {srs_id} is not a JGD2011 plane rectangular coordinate system"
                ),
            })?;
            let level = parts
                .get(4)
                .and_then(|value| value.parse().ok())
                .ok_or_else(|| MapLibreError::UnsupportedLayer {
                    layer: table_name.clone(),
                    reason: "map level is missing from the layer name".to_string(),
                })?;
            Ok(GpkgLayer {
                table_name,
                kind,
                zone,
                level,
                decoration,
                bounds,
            })
        })
        .collect()
}

fn source_layer_from_table(layer: &GpkgLayer) -> String {
    let parts = layer.table_name.split('_').collect::<Vec<_>>();
    if layer.decoration {
        format!(
            "dm_{}_{}_deco_{}",
            parts.get(1).copied().unwrap_or_default(),
            parts.get(2).copied().unwrap_or_default(),
            layer.kind.as_str()
        )
    } else {
        format!(
            "dm_{}_{}",
            parts.get(1).copied().unwrap_or_default(),
            layer.kind.as_str()
        )
    }
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn transform_points(
    source: &Proj,
    destination: &Proj,
    points: &[Coordinate],
) -> Result<Vec<Coordinate>, MapLibreError> {
    let mut tuples = points
        .iter()
        .map(|point| (point.x, point.y, point.z.unwrap_or(0.0)))
        .collect::<Vec<_>>();
    transform::transform(source, destination, tuples.as_mut_slice())
        .map_err(|error| MapLibreError::Projection(error.to_string()))?;
    Ok(tuples
        .into_iter()
        .map(|(x, y, z)| Coordinate { x, y, z: Some(z) })
        .collect())
}

fn zone_from_srs_id(srs_id: i64) -> Option<u8> {
    srs_id
        .checked_sub(6668)
        .and_then(|zone| u8::try_from(zone).ok())
        .filter(|zone| (1..=19).contains(zone))
}

fn zone_origin(zone: u8) -> Result<(f64, f64), MapLibreError> {
    const ORIGINS: [(f64, f64); 19] = [
        (33.0, 129.5),
        (33.0, 131.0),
        (36.0, 132.166666666667),
        (33.0, 133.5),
        (36.0, 134.333333333333),
        (36.0, 136.0),
        (36.0, 137.166666666667),
        (36.0, 138.5),
        (36.0, 139.833333333333),
        (40.0, 140.833333333333),
        (44.0, 140.25),
        (44.0, 142.25),
        (44.0, 144.25),
        (26.0, 142.0),
        (26.0, 127.5),
        (26.0, 124.0),
        (26.0, 131.0),
        (20.0, 136.0),
        (26.0, 154.0),
    ];
    ORIGINS
        .get(usize::from(zone).wrapping_sub(1))
        .copied()
        .ok_or_else(|| MapLibreError::Projection(format!("unsupported zone {zone}")))
}

fn mercator_to_lon_lat(point: Coordinate) -> (f64, f64) {
    let lon = point.x / WEB_MERCATOR_HALF * 180.0;
    let lat =
        (2.0 * (point.y / 6_378_137.0).exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees();
    (lon, lat)
}

fn tile_keys(
    layers: &[GpkgLayer],
    projector: &Projector,
) -> Result<BTreeSet<TileKey>, MapLibreError> {
    let mut keys = BTreeSet::new();
    for layer in layers {
        let corners = [
            Coordinate {
                x: layer.bounds[0],
                y: layer.bounds[1],
                z: None,
            },
            Coordinate {
                x: layer.bounds[0],
                y: layer.bounds[3],
                z: None,
            },
            Coordinate {
                x: layer.bounds[2],
                y: layer.bounds[1],
                z: None,
            },
            Coordinate {
                x: layer.bounds[2],
                y: layer.bounds[3],
                z: None,
            },
        ];
        let projected = projector.project(layer.zone, &corners)?;
        for zoom in MIN_ZOOM..=MAX_ZOOM {
            let (min_x, min_y, max_x, max_y) = tile_range(&projected, zoom);
            for x in min_x..=max_x {
                for y in min_y..=max_y {
                    keys.insert(TileKey { z: zoom, x, y });
                }
            }
        }
    }
    Ok(keys)
}

fn tile_range(points: &[Coordinate], z: u8) -> (u32, u32, u32, u32) {
    let first = points[0];
    let mut bounds = [first.x, first.y, first.x, first.y];
    for point in &points[1..] {
        bounds[0] = bounds[0].min(point.x);
        bounds[1] = bounds[1].min(point.y);
        bounds[2] = bounds[2].max(point.x);
        bounds[3] = bounds[3].max(point.y);
    }
    let tile_width = 2.0 * WEB_MERCATOR_HALF / f64::from(1_u32 << z);
    let buffer = tile_width * f64::from(BUFFER) / f64::from(EXTENT);
    let min = mercator_tile(bounds[0] - buffer, bounds[3] + buffer, z);
    let max = mercator_tile(bounds[2] + buffer, bounds[1] - buffer, z);
    (min.0, min.1, max.0, max.1)
}

fn mercator_tile(x: f64, y: f64, z: u8) -> (u32, u32) {
    let count = 1_u32 << z;
    let tx = ((x + WEB_MERCATOR_HALF) / (2.0 * WEB_MERCATOR_HALF) * f64::from(count))
        .floor()
        .clamp(0.0, f64::from(count - 1)) as u32;
    let ty = ((WEB_MERCATOR_HALF - y) / (2.0 * WEB_MERCATOR_HALF) * f64::from(count))
        .floor()
        .clamp(0.0, f64::from(count - 1)) as u32;
    (tx, ty)
}

fn encode_tile(key: TileKey, layers: TileLayers) -> Result<Vec<u8>, MapLibreError> {
    let layers = layers
        .into_iter()
        .filter_map(|(name, features)| {
            encode_layer(
                key,
                name,
                features.iter().map(Arc::as_ref).collect::<Vec<_>>(),
            )
        })
        .collect();
    let tile = vector_tile::Tile { layers };
    Ok(tile.encode_to_vec())
}

fn encode_layer(
    key: TileKey,
    name: String,
    features: Vec<&ProjectedFeature>,
) -> Option<vector_tile::Layer> {
    let mut encoder = LayerEncoder::default();
    let encoded = features
        .into_iter()
        .filter_map(|feature| encode_feature(key, feature, &mut encoder))
        .collect::<Vec<_>>();
    if encoded.is_empty() {
        return None;
    }
    Some(vector_tile::Layer {
        version: 2,
        name,
        features: encoded,
        keys: encoder.keys,
        values: encoder.values,
        extent: Some(EXTENT),
    })
}

fn encode_feature(
    key: TileKey,
    input: &ProjectedFeature,
    encoder: &mut LayerEncoder,
) -> Option<vector_tile::Feature> {
    let points = input
        .points
        .iter()
        .map(|point| tile_point(*point, key))
        .collect::<Vec<_>>();
    let geometry = clipped_geometry(input.feature.geometry_kind, &points)?;
    let mut tags = Vec::new();
    push_int(&mut tags, encoder, "USER_ID", input.user_id);
    push_int(&mut tags, encoder, "DMCODE", input.feature.dmcode);
    push_int_opt(
        &mut tags,
        encoder,
        "ZONE",
        input.feature.plane_rectangular_zone.map(i64::from),
    );
    push_int_opt(&mut tags, encoder, "LEVEL", input.feature.map_level);
    push_string(&mut tags, encoder, "DMFILE", &input.feature.source_file);
    push_int_opt(
        &mut tags,
        encoder,
        "DMFIGTYPE",
        input.feature.attributes.dmfigtype,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMMOVE",
        input.feature.attributes.dmmove,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMSKIP",
        input.feature.attributes.dmskip,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMATTR",
        input.feature.attributes.dmattr,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMPREC",
        input.feature.attributes.dmprec,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMYYMM",
        input.feature.attributes.dmyymm,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMREGION",
        input.feature.attributes.dmregion,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMINFO",
        input.feature.attributes.dminfo,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMELEMID",
        input.feature.attributes.dmelemid,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMATTRKIND",
        input.feature.attributes.dmattrkind,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMUPYYMM",
        input.feature.attributes.dmupyymm,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "DMDELYYMM",
        input.feature.attributes.dmdelyymm,
    );
    if let Some(data) = input.feature.attributes.dmattrdata.as_deref() {
        push_string(&mut tags, encoder, "DMATTRDATA", data);
    }
    if let Some(text) = input.feature.attributes.text.as_deref() {
        push_string(&mut tags, encoder, "TEXT", text);
        if let Some(vertical_text) = vertical_annotation_text(text) {
            push_string(&mut tags, encoder, "TEXT_VERTICAL", &vertical_text);
        }
    }
    if let Some(size) = input.feature.attributes.size {
        push_double(&mut tags, encoder, "SIZE", size);
    }
    if let Some(char_spacing) = input.feature.attributes.char_spacing {
        push_double(&mut tags, encoder, "CHARSPACING", char_spacing);
    }
    push_int_opt(
        &mut tags,
        encoder,
        "LINENO",
        input.feature.attributes.line_no,
    );
    push_int_opt(
        &mut tags,
        encoder,
        "VERTICAL",
        input.feature.attributes.vertical,
    );
    if let Some(rotation) = rotation(input) {
        push_double(&mut tags, encoder, "ROTATION", rotation);
    }
    if let Some(decoration) = &input.decoration {
        push_string(&mut tags, encoder, "SRC_LAYER", &decoration.src_layer);
        push_int(&mut tags, encoder, "SRC_USER_ID", decoration.src_user_id);
        push_string(&mut tags, encoder, "SRC_DMFILE", &decoration.src_dmfile);
        push_int(&mut tags, encoder, "SRC_DMCODE", decoration.src_dmcode);
        push_string(&mut tags, encoder, "DECORATION", &decoration.decoration);
        push_int(&mut tags, encoder, "DECO_INDEX", decoration.deco_index);
    }
    Some(vector_tile::Feature {
        id: None,
        tags,
        r#type: Some(match input.feature.geometry_kind {
            GeometryKind::Point | GeometryKind::Text => 1,
            GeometryKind::Line => 2,
            GeometryKind::Polygon => 3,
        }),
        geometry,
    })
}

fn tile_point(point: Coordinate, tile: TileKey) -> (i32, i32) {
    let count = f64::from(1_u32 << tile.z);
    let world_x = (point.x + WEB_MERCATOR_HALF) / (2.0 * WEB_MERCATOR_HALF) * count;
    let world_y = (WEB_MERCATOR_HALF - point.y) / (2.0 * WEB_MERCATOR_HALF) * count;
    (
        round_away((world_x - f64::from(tile.x)) * f64::from(EXTENT)),
        round_away((world_y - f64::from(tile.y)) * f64::from(EXTENT)),
    )
}

fn round_away(value: f64) -> i32 {
    if value >= 0.0 {
        (value + 0.5).floor() as i32
    } else {
        (value - 0.5).ceil() as i32
    }
}

fn clipped_geometry(kind: GeometryKind, points: &[(i32, i32)]) -> Option<Vec<u32>> {
    let parts = match kind {
        GeometryKind::Point | GeometryKind::Text => {
            let point = *points.first()?;
            inside(point).then(|| vec![vec![point]])?
        }
        GeometryKind::Line => clip_line(points),
        GeometryKind::Polygon => {
            let ring = clip_polygon(points);
            if ring.len() < 3 || signed_area(&ring).abs() < f64::EPSILON {
                return None;
            }
            vec![clockwise(ring)]
        }
    };
    encode_geometry(kind, &parts)
}

fn encode_geometry(kind: GeometryKind, parts: &[Vec<(i32, i32)>]) -> Option<Vec<u32>> {
    let mut output = Vec::new();
    let mut cursor = (0, 0);
    for part in parts {
        if part.is_empty() {
            continue;
        }
        output.push(command(1, 1));
        delta(&mut output, &mut cursor, part[0]);
        if matches!(kind, GeometryKind::Line | GeometryKind::Polygon) {
            if part.len() < 2 {
                continue;
            }
            output.push(command(2, (part.len() - 1) as u32));
            for point in &part[1..] {
                delta(&mut output, &mut cursor, *point);
            }
            if kind == GeometryKind::Polygon {
                output.push(command(7, 1));
            }
        }
    }
    (!output.is_empty()).then_some(output)
}

fn inside(point: (i32, i32)) -> bool {
    (-BUFFER..=EXTENT as i32 + BUFFER).contains(&point.0)
        && (-BUFFER..=EXTENT as i32 + BUFFER).contains(&point.1)
}

fn clip_line(points: &[(i32, i32)]) -> Vec<Vec<(i32, i32)>> {
    let mut parts: Vec<Vec<(i32, i32)>> = Vec::new();
    for segment in points.windows(2) {
        let Some((start, end)) = clip_segment(segment[0], segment[1]) else {
            continue;
        };
        if let Some(part) = parts.last_mut()
            && part.last() == Some(&start)
        {
            if part.last() != Some(&end) {
                part.push(end);
            }
            continue;
        }
        parts.push(vec![start, end]);
    }
    parts
        .into_iter()
        .map(|part| simplify(&part, SIMPLIFY_TOLERANCE))
        .filter(|part| part.len() >= 2)
        .collect()
}

fn clip_segment(start: (i32, i32), end: (i32, i32)) -> Option<((i32, i32), (i32, i32))> {
    let min = -f64::from(BUFFER);
    let max = f64::from(EXTENT) + f64::from(BUFFER);
    let (x0, y0) = (f64::from(start.0), f64::from(start.1));
    let (dx, dy) = (f64::from(end.0 - start.0), f64::from(end.1 - start.1));
    let mut lower = 0.0_f64;
    let mut upper = 1.0_f64;
    for (p, q) in [
        (-dx, x0 - min),
        (dx, max - x0),
        (-dy, y0 - min),
        (dy, max - y0),
    ] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let ratio = q / p;
            if p < 0.0 {
                lower = lower.max(ratio);
            } else {
                upper = upper.min(ratio);
            }
        }
    }
    (lower <= upper).then(|| {
        (
            (round_away(x0 + lower * dx), round_away(y0 + lower * dy)),
            (round_away(x0 + upper * dx), round_away(y0 + upper * dy)),
        )
    })
}

fn simplify(points: &[(i32, i32)], tolerance: f64) -> Vec<(i32, i32)> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let (index, distance) = points[1..points.len() - 1]
        .iter()
        .enumerate()
        .map(|(index, point)| {
            (
                index + 1,
                perpendicular_distance(*point, points[0], points[points.len() - 1]),
            )
        })
        .max_by(|left, right| left.1.total_cmp(&right.1))
        .unwrap_or((0, 0.0));
    if distance <= tolerance {
        return vec![points[0], points[points.len() - 1]];
    }
    let mut left = simplify(&points[..=index], tolerance);
    let right = simplify(&points[index..], tolerance);
    left.pop();
    left.extend(right);
    left
}

fn perpendicular_distance(point: (i32, i32), start: (i32, i32), end: (i32, i32)) -> f64 {
    let dx = f64::from(end.0 - start.0);
    let dy = f64::from(end.1 - start.1);
    if dx == 0.0 && dy == 0.0 {
        return f64::from(point.0 - start.0).hypot(f64::from(point.1 - start.1));
    }
    (dy * f64::from(point.0 - start.0) - dx * f64::from(point.1 - start.1)).abs() / dx.hypot(dy)
}

fn clip_polygon(points: &[(i32, i32)]) -> Vec<(i32, i32)> {
    let mut ring = points.to_vec();
    if ring.first() == ring.last() {
        ring.pop();
    }
    for edge in 0..4 {
        let input = std::mem::take(&mut ring);
        if input.is_empty() {
            break;
        }
        let mut previous = *input.last().expect("non-empty polygon ring");
        for current in input {
            let current_inside = polygon_inside(current, edge);
            let previous_inside = polygon_inside(previous, edge);
            if current_inside != previous_inside {
                ring.push(polygon_intersection(previous, current, edge));
            }
            if current_inside {
                ring.push(current);
            }
            previous = current;
        }
    }
    ring.dedup();
    ring
}

fn polygon_inside(point: (i32, i32), edge: usize) -> bool {
    let min = -BUFFER;
    let max = EXTENT as i32 + BUFFER;
    match edge {
        0 => point.0 >= min,
        1 => point.0 <= max,
        2 => point.1 >= min,
        _ => point.1 <= max,
    }
}

fn polygon_intersection(start: (i32, i32), end: (i32, i32), edge: usize) -> (i32, i32) {
    let min = -BUFFER;
    let max = EXTENT as i32 + BUFFER;
    let (boundary, horizontal) = match edge {
        0 => (min, false),
        1 => (max, false),
        2 => (min, true),
        _ => (max, true),
    };
    if horizontal {
        let ratio = f64::from(boundary - start.1) / f64::from(end.1 - start.1);
        (
            round_away(f64::from(start.0) + ratio * f64::from(end.0 - start.0)),
            boundary,
        )
    } else {
        let ratio = f64::from(boundary - start.0) / f64::from(end.0 - start.0);
        (
            boundary,
            round_away(f64::from(start.1) + ratio * f64::from(end.1 - start.1)),
        )
    }
}

fn signed_area(ring: &[(i32, i32)]) -> f64 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(left, right)| f64::from(left.0 * right.1 - right.0 * left.1))
        .sum::<f64>()
        / 2.0
}

fn clockwise(mut ring: Vec<(i32, i32)>) -> Vec<(i32, i32)> {
    if signed_area(&ring) < 0.0 {
        ring.reverse();
    }
    ring
}

fn command(id: u32, count: u32) -> u32 {
    (count << 3) | id
}

fn delta(output: &mut Vec<u32>, cursor: &mut (i32, i32), point: (i32, i32)) {
    output.push(zigzag(point.0 - cursor.0));
    output.push(zigzag(point.1 - cursor.1));
    *cursor = point;
}

fn zigzag(value: i32) -> u32 {
    ((value << 1) ^ (value >> 31)) as u32
}

fn rotation(input: &ProjectedFeature) -> Option<f64> {
    let angle = input.feature.attributes.angle?;
    let rotation = if input.feature.geometry_kind == GeometryKind::Text {
        -angle
    } else {
        90.0 - angle
    };
    Some(rotation.rem_euclid(360.0))
}

fn vertical_annotation_text(text: &str) -> Option<String> {
    let vertical = text.replace('ー', "︱");
    (vertical != text).then_some(vertical)
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum ValueKey {
    Int(i64),
    Double(u64),
    String(String),
}

#[derive(Debug, Default)]
struct LayerEncoder {
    keys: Vec<String>,
    values: Vec<vector_tile::Value>,
    key_lookup: HashMap<String, u32>,
    value_lookup: HashMap<ValueKey, u32>,
}

impl LayerEncoder {
    fn push_value(&mut self, tags: &mut Vec<u32>, key: &str, value: vector_tile::Value) {
        let key_index = if let Some(index) = self.key_lookup.get(key) {
            *index
        } else {
            let index = self.keys.len() as u32;
            self.keys.push(key.to_string());
            self.key_lookup.insert(key.to_string(), index);
            index
        };
        let value_key = value_key(&value);
        let value_index = if let Some(index) = self.value_lookup.get(&value_key) {
            *index
        } else {
            let index = self.values.len() as u32;
            self.values.push(value);
            self.value_lookup.insert(value_key, index);
            index
        };
        tags.extend([key_index, value_index]);
    }
}

fn value_key(value: &vector_tile::Value) -> ValueKey {
    if let Some(value) = value.int_value {
        ValueKey::Int(value)
    } else if let Some(value) = value.double_value {
        ValueKey::Double(value.to_bits())
    } else if let Some(value) = value.string_value.as_ref() {
        ValueKey::String(value.clone())
    } else {
        ValueKey::String(String::new())
    }
}

fn push_int_opt(tags: &mut Vec<u32>, encoder: &mut LayerEncoder, key: &str, value: Option<i64>) {
    if let Some(value) = value {
        push_int(tags, encoder, key, value);
    }
}

fn push_int(tags: &mut Vec<u32>, encoder: &mut LayerEncoder, key: &str, value: i64) {
    encoder.push_value(
        tags,
        key,
        vector_tile::Value {
            int_value: Some(value),
            ..vector_tile::Value::default()
        },
    );
}

fn push_double(tags: &mut Vec<u32>, encoder: &mut LayerEncoder, key: &str, value: f64) {
    encoder.push_value(
        tags,
        key,
        vector_tile::Value {
            double_value: Some(value),
            ..vector_tile::Value::default()
        },
    );
}

fn push_string(tags: &mut Vec<u32>, encoder: &mut LayerEncoder, key: &str, value: &str) {
    encoder.push_value(
        tags,
        key,
        vector_tile::Value {
            string_value: Some(value.to_string()),
            ..vector_tile::Value::default()
        },
    );
}

fn read_layer_features(
    connection: &Connection,
    layer: &GpkgLayer,
    projector: &Projector,
) -> Result<Vec<ProjectedFeature>, MapLibreError> {
    let table = quote_identifier(&layer.table_name);
    let sql = if layer.decoration {
        format!(
            "SELECT f.geom, f.USER_ID, f.SRC_LAYER, f.SRC_USER_ID, f.SRC_DMFILE,
                    f.SRC_DMCODE, f.DECORATION, f.DECO_INDEX,
                    {} AS ANGLE
             FROM {table} f
             ORDER BY f.fid",
            if layer.kind == GeometryKind::Point {
                "f.ANGLE"
            } else {
                "NULL"
            }
        )
    } else {
        let angle = matches!(layer.kind, GeometryKind::Point | GeometryKind::Text)
            .then_some("f.ANGLE")
            .unwrap_or("NULL");
        let (size, char_spacing, line_no, vertical, text) = if layer.kind == GeometryKind::Text {
            (
                "f.SIZE",
                "f.CHARSPACING",
                "f.LINENO",
                "f.VERTICAL",
                "f.TEXT",
            )
        } else {
            ("NULL", "NULL", "NULL", "NULL", "NULL")
        };
        format!(
            "SELECT f.geom, f.USER_ID, f.DMCODE, f.LEVEL, f.DMFIGTYPE, f.DMMOVE,
                    f.DMSKIP, f.DMATTR, f.DMPREC, f.DMYYMM, f.DMREGION, f.DMINFO,
                    f.DMELEMID, f.DMATTRKIND, f.DMUPYYMM, f.DMDELYYMM, f.DMATTRDATA,
                    f.DMFILE,
                    {angle} AS ANGLE, {size} AS SIZE,
                    {char_spacing} AS CHARSPACING, {line_no} AS LINENO,
                    {vertical} AS VERTICAL, {text} AS TEXT
             FROM {table} f
             ORDER BY f.fid"
        )
    };
    let mut statement = connection.prepare_cached(&sql)?;
    let mut rows = statement.query([])?;
    let mut features = Vec::new();
    while let Some(row) = rows.next()? {
        features.push(if layer.decoration {
            read_decoration_row(row, layer, projector)?
        } else {
            read_feature_row(row, layer, projector)?
        });
    }
    Ok(features)
}

fn read_feature_row(
    row: &Row<'_>,
    layer: &GpkgLayer,
    projector: &Projector,
) -> Result<ProjectedFeature, MapLibreError> {
    let blob: Vec<u8> = row.get(0)?;
    let points = read_geometry(&blob, layer.kind)?;
    let projected = projector.project(layer.zone, &points)?;
    let dmcode = row.get(2)?;
    let map_level = row.get(3)?;
    let feature = Feature {
        source_file: row.get(17)?,
        source_line: 0,
        plane_rectangular_zone: Some(layer.zone),
        map_level,
        dmcode,
        geometry_kind: layer.kind,
        geometry: geometry_from_points(layer.kind, points),
        attributes: dm_parser::Attributes {
            dmfigtype: row.get(4)?,
            dmmove: row.get(5)?,
            dmskip: row.get(6)?,
            dmattr: row.get(7)?,
            dmprec: row.get(8)?,
            dmyymm: row.get(9)?,
            dmregion: row.get(10)?,
            dminfo: row.get(11)?,
            dmelemid: row.get(12)?,
            dmattrkind: row.get(13)?,
            dmupyymm: row.get(14)?,
            dmdelyymm: row.get(15)?,
            dmattrdata: row.get(16)?,
            angle: row.get(18)?,
            size: row.get(19)?,
            char_spacing: row.get(20)?,
            line_no: row.get(21)?,
            vertical: row.get(22)?,
            text: row.get(23)?,
        },
        warnings: Vec::new(),
    };
    Ok(ProjectedFeature {
        feature,
        user_id: row.get(1)?,
        points: projected,
        decoration: None,
    })
}

fn read_decoration_row(
    row: &Row<'_>,
    layer: &GpkgLayer,
    projector: &Projector,
) -> Result<ProjectedFeature, MapLibreError> {
    let blob: Vec<u8> = row.get(0)?;
    let points = read_geometry(&blob, layer.kind)?;
    let projected = projector.project(layer.zone, &points)?;
    let src_layer: String = row.get(2)?;
    let src_dmcode = row.get(5)?;
    let feature = Feature {
        source_file: row.get(4)?,
        source_line: 0,
        plane_rectangular_zone: Some(layer.zone),
        map_level: Some(layer.level),
        dmcode: src_dmcode,
        geometry_kind: layer.kind,
        geometry: geometry_from_points(layer.kind, points),
        attributes: dm_parser::Attributes {
            angle: row.get(8)?,
            ..dm_parser::Attributes::default()
        },
        warnings: Vec::new(),
    };
    Ok(ProjectedFeature {
        feature,
        user_id: row.get(1)?,
        points: projected,
        decoration: Some(MapDecoration {
            src_layer,
            src_user_id: row.get(3)?,
            src_dmfile: row.get(4)?,
            src_dmcode,
            decoration: row.get(6)?,
            deco_index: row.get(7)?,
        }),
    })
}

fn read_geometry(blob: &[u8], kind: GeometryKind) -> Result<Vec<Coordinate>, MapLibreError> {
    // GeoPackage BLOB header is 8 bytes, followed by a 32-byte XY envelope.
    const WKB_OFFSET: usize = 40;
    let mut offset = WKB_OFFSET;
    if blob.len() < offset + 5 || &blob[..2] != b"GP" || blob[offset] != 1 {
        return Err(MapLibreError::Asset(
            "invalid GeoPackage geometry".to_string(),
        ));
    }
    offset += 1;
    let geometry_type = read_u32(blob, &mut offset)?;
    let expected_type = match kind {
        GeometryKind::Point | GeometryKind::Text => 1,
        GeometryKind::Line => 2,
        GeometryKind::Polygon => 3,
    };
    if geometry_type != expected_type {
        return Err(MapLibreError::Asset(
            "unexpected GeoPackage geometry type".to_string(),
        ));
    }
    if geometry_type == 1 {
        return Ok(vec![read_coordinate(blob, &mut offset)?]);
    }
    if geometry_type == 3 && read_u32(blob, &mut offset)? != 1 {
        return Err(MapLibreError::Asset(
            "multiple polygon rings are not supported".to_string(),
        ));
    }
    let count = read_u32(blob, &mut offset)? as usize;
    (0..count)
        .map(|_| read_coordinate(blob, &mut offset))
        .collect()
}

fn read_u32(blob: &[u8], offset: &mut usize) -> Result<u32, MapLibreError> {
    let bytes: [u8; 4] = blob
        .get(*offset..*offset + 4)
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| MapLibreError::Asset("truncated GeoPackage geometry".to_string()))?;
    *offset += 4;
    Ok(u32::from_le_bytes(bytes))
}

fn read_coordinate(blob: &[u8], offset: &mut usize) -> Result<Coordinate, MapLibreError> {
    let x = read_f64(blob, offset)?;
    let y = read_f64(blob, offset)?;
    Ok(Coordinate { x, y, z: None })
}

fn read_f64(blob: &[u8], offset: &mut usize) -> Result<f64, MapLibreError> {
    let bytes: [u8; 8] = blob
        .get(*offset..*offset + 8)
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| MapLibreError::Asset("truncated GeoPackage geometry".to_string()))?;
    *offset += 8;
    Ok(f64::from_le_bytes(bytes))
}

fn geometry_from_points(kind: GeometryKind, points: Vec<Coordinate>) -> Geometry {
    match kind {
        GeometryKind::Point => Geometry::Point(points[0]),
        GeometryKind::Text => Geometry::TextPoint(points[0]),
        GeometryKind::Line => Geometry::LineString(points),
        GeometryKind::Polygon => Geometry::Polygon(points),
    }
}

fn write_pmtiles(
    output: &Path,
    layer_name: &str,
    summary: &MapLibreSummary,
    source: &TileSource<'_>,
    keys: BTreeSet<TileKey>,
    progress: bool,
) -> Result<u64, MapLibreError> {
    let center = [
        (summary.bounds[0] + summary.bounds[2]) / 2.0,
        (summary.bounds[1] + summary.bounds[3]) / 2.0,
    ];
    let vector_layers = summary
        .source_layers
        .iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|id| json!({"id": id, "minzoom": MIN_ZOOM, "maxzoom": MAX_ZOOM}))
        .collect::<Vec<_>>();
    let metadata = serde_json::to_string(&json!({
        "name": layer_name,
        "format": "pbf",
        "type": "overlay",
        "minzoom": MIN_ZOOM,
        "maxzoom": MAX_ZOOM,
        "bounds": summary.bounds,
        "center": [center[0], center[1], MIN_ZOOM],
        "vector_layers": vector_layers
    }))?;
    let file = File::create(output.join(format!("{layer_name}.pmtiles")))?;
    let mut writer = PmTilesWriter::new(TileType::Mvt)
        .min_zoom(MIN_ZOOM)
        .max_zoom(MAX_ZOOM)
        .bounds(
            summary.bounds[0],
            summary.bounds[1],
            summary.bounds[2],
            summary.bounds[3],
        )
        .center(center[0], center[1])
        .center_zoom(MIN_ZOOM)
        .metadata(&metadata)
        .create(file)?;
    let candidate_count = keys.len();
    let mut tile_feature_layers = collect_tile_feature_layers(source, &keys)?;
    let total_tile_weight = total_pmtiles_tile_weight(&keys, &tile_feature_layers);
    let mut tile_weights = Vec::with_capacity(candidate_count);
    let mut tiles_to_encode = Vec::new();
    for key in keys {
        let tile_weight = pmtiles_tile_weight(tile_feature_layers.get(&key));
        if let Some(tile_layers) = tile_feature_layers.remove(&key) {
            tiles_to_encode.push((key, tile_layers));
        }
        tile_weights.push((key, tile_weight));
    }
    let encoded_tiles = tiles_to_encode
        .into_par_iter()
        .map(|(key, tile_layers)| {
            let tile = encode_tile(key, tile_layers)?;
            let coord = TileCoord::new(key.z, key.x, key.y)?;
            Ok((key, coord, tile))
        })
        .collect::<Vec<Result<(TileKey, TileCoord, Vec<u8>), MapLibreError>>>();
    let mut encoded_tiles = encoded_tiles
        .into_iter()
        .map(|result| result.map(|(key, coord, tile)| (key, (coord, tile))))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut tile_count = 0;
    let mut done_tile_weight = 0.0;
    let mut progress_display = ProgressDisplay::new(progress);
    for (index, (key, tile_weight)) in tile_weights.into_iter().enumerate() {
        if let Some((coord, tile)) = encoded_tiles.remove(&key) {
            writer.add_tile(coord, &tile)?;
            tile_count += 1;
        }
        done_tile_weight += tile_weight;
        progress_display.weighted_progress(
            index + 1,
            candidate_count,
            done_tile_weight,
            total_tile_weight,
            "pmtiles tile",
        );
    }
    drop(progress_display);
    timed("finalizing PMTiles archive", || writer.finalize())?;
    Ok(tile_count)
}

fn collect_tile_feature_layers(
    source: &TileSource<'_>,
    candidate_keys: &BTreeSet<TileKey>,
) -> Result<BTreeMap<TileKey, TileLayers>, MapLibreError> {
    let mut tiles = BTreeMap::new();
    for layer in source.layers {
        let source_layer = source_layer_from_table(layer);
        for feature in read_layer_features(source.connection, layer, source.projector)? {
            add_feature_to_tiles(
                &mut tiles,
                candidate_keys,
                source_layer.as_str(),
                Arc::new(feature),
            );
        }
    }
    Ok(tiles)
}

fn add_feature_to_tiles(
    tiles: &mut BTreeMap<TileKey, TileLayers>,
    candidate_keys: &BTreeSet<TileKey>,
    source_layer: &str,
    feature: Arc<ProjectedFeature>,
) {
    for zoom in MIN_ZOOM..=MAX_ZOOM {
        let (min_x, min_y, max_x, max_y) = tile_range(&feature.points, zoom);
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                let key = TileKey { z: zoom, x, y };
                if !candidate_keys.contains(&key) {
                    continue;
                }
                let tile_layers = tiles.entry(key).or_default();
                add_tile_layer_feature(tile_layers, source_layer, Arc::clone(&feature));
            }
        }
    }
}

fn total_pmtiles_tile_weight(
    keys: &BTreeSet<TileKey>,
    tile_feature_layers: &BTreeMap<TileKey, TileLayers>,
) -> f64 {
    keys.iter()
        .map(|key| pmtiles_tile_weight(tile_feature_layers.get(key)))
        .sum()
}

fn pmtiles_tile_weight(tile_layers: Option<&TileLayers>) -> f64 {
    1.0 + tile_layers
        .map(|layers| layers.values().map(Vec::len).sum::<usize>() as f64)
        .unwrap_or_default()
}

fn add_tile_layer_feature(
    tile_layers: &mut TileLayers,
    name: &str,
    feature: Arc<ProjectedFeature>,
) {
    tile_layers
        .entry(name.to_string())
        .or_default()
        .push(feature);
}

fn write_manifest(
    output: &Path,
    layer_name: &str,
    summary: &MapLibreSummary,
) -> Result<(), MapLibreError> {
    let center = [
        (summary.bounds[0] + summary.bounds[2]) / 2.0,
        (summary.bounds[1] + summary.bounds[3]) / 2.0,
        15.0,
    ];
    let manifest = json!({
        "version": 1,
        "layerName": layer_name,
        "pmtiles": format!("{layer_name}.pmtiles"),
        "levels": summary.levels,
        "sourceLayers": summary.source_layers,
        "bounds": summary.bounds,
        "center": center,
    });
    fs::write(
        output.join("pmtiles-manifest.json"),
        serde_json::to_string_pretty(&manifest)? + "\n",
    )?;
    Ok(())
}

mod vector_tile {
    #[derive(Clone, PartialEq, prost::Message)]
    pub struct Tile {
        #[prost(message, repeated, tag = "3")]
        pub layers: Vec<Layer>,
    }

    #[derive(Clone, PartialEq, prost::Message)]
    pub struct Layer {
        #[prost(uint32, required, tag = "15")]
        pub version: u32,
        #[prost(string, required, tag = "1")]
        pub name: String,
        #[prost(message, repeated, tag = "2")]
        pub features: Vec<Feature>,
        #[prost(string, repeated, tag = "3")]
        pub keys: Vec<String>,
        #[prost(message, repeated, tag = "4")]
        pub values: Vec<Value>,
        #[prost(uint32, optional, tag = "5")]
        pub extent: Option<u32>,
    }

    #[derive(Clone, PartialEq, prost::Message)]
    pub struct Feature {
        #[prost(uint64, optional, tag = "1")]
        pub id: Option<u64>,
        #[prost(uint32, repeated, packed = "true", tag = "2")]
        pub tags: Vec<u32>,
        #[prost(enumeration = "GeomType", optional, tag = "3")]
        pub r#type: Option<i32>,
        #[prost(uint32, repeated, packed = "true", tag = "4")]
        pub geometry: Vec<u32>,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
    #[repr(i32)]
    pub enum GeomType {
        Unknown = 0,
        Point = 1,
        Linestring = 2,
        Polygon = 3,
    }

    #[derive(Clone, PartialEq, prost::Message)]
    pub struct Value {
        #[prost(string, optional, tag = "1")]
        pub string_value: Option<String>,
        #[prost(float, optional, tag = "2")]
        pub float_value: Option<f32>,
        #[prost(double, optional, tag = "3")]
        pub double_value: Option<f64>,
        #[prost(int64, optional, tag = "4")]
        pub int_value: Option<i64>,
        #[prost(uint64, optional, tag = "5")]
        pub uint_value: Option<u64>,
        #[prost(sint64, optional, tag = "6")]
        pub sint_value: Option<i64>,
        #[prost(bool, optional, tag = "7")]
        pub bool_value: Option<bool>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_version_one_maplibre_manifest() {
        let output = tempfile::tempdir().unwrap();
        let summary = MapLibreSummary {
            bounds: [130.0, 30.0, 140.0, 40.0],
            levels: BTreeSet::from([2500, 5000]),
            source_layers: BTreeSet::from([
                "dm_2100_line".to_string(),
                "dm_3001_polygon".to_string(),
            ]),
            ..MapLibreSummary::default()
        };

        write_manifest(output.path(), "dm-sample", &summary).unwrap();

        let manifest: serde_json::Value = serde_json::from_reader(
            File::open(output.path().join("pmtiles-manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["version"], 1);
        assert_eq!(manifest["layerName"], "dm-sample");
        assert_eq!(manifest["pmtiles"], "dm-sample.pmtiles");
        assert_eq!(manifest["levels"], json!([2500, 5000]));
        assert_eq!(
            manifest["sourceLayers"],
            json!(["dm_2100_line", "dm_3001_polygon"])
        );
        assert_eq!(manifest["bounds"], json!([130.0, 30.0, 140.0, 40.0]));
        assert_eq!(manifest["center"], json!([135.0, 35.0, 15.0]));
    }

    #[test]
    fn zone_table_contains_all_japan_plane_rectangular_origins() {
        assert_eq!(zone_origin(1).unwrap(), (33.0, 129.5));
        assert_eq!(zone_origin(19).unwrap(), (26.0, 154.0));
        assert!(zone_origin(0).is_err());
        assert!(zone_origin(20).is_err());
    }

    #[test]
    fn rejects_layer_without_supported_plane_rectangular_srs() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE gpkg_contents (
                   table_name TEXT PRIMARY KEY,
                   data_type TEXT NOT NULL,
                   min_x REAL,
                   min_y REAL,
                   max_x REAL,
                   max_y REAL
                 );
                 CREATE TABLE gpkg_geometry_columns (
                   table_name TEXT PRIMARY KEY,
                   geometry_type_name TEXT NOT NULL,
                   srs_id INTEGER NOT NULL
                 );
                 INSERT INTO gpkg_contents
                   (table_name, data_type, min_x, min_y, max_x, max_y)
                 VALUES ('dm_2100_line_none_2500', 'features', 0, 0, 1, 1);
                 INSERT INTO gpkg_geometry_columns
                   (table_name, geometry_type_name, srs_id)
                 VALUES ('dm_2100_line_none_2500', 'LINESTRING', -1);",
            )
            .unwrap();

        let error = read_layers(&connection).unwrap_err();
        assert_eq!(
            error.to_string(),
            "unsupported GeoPackage layer dm_2100_line_none_2500: \
             SRS ID -1 is not a JGD2011 plane rectangular coordinate system"
        );
    }

    #[test]
    fn rotation_is_normalized_clockwise() {
        let mut feature = sample_feature();
        feature.attributes.angle = Some(100.0);
        let projected = ProjectedFeature {
            feature,
            user_id: 1,
            points: vec![],
            decoration: None,
        };
        assert_eq!(rotation(&projected), Some(350.0));
    }

    #[test]
    fn vertical_annotation_text_replaces_long_sound_marks() {
        assert_eq!(
            vertical_annotation_text("スーパーー堤"),
            Some("ス︱パ︱︱堤".to_string())
        );
        assert_eq!(vertical_annotation_text("河川"), None);
    }

    #[test]
    fn tile_layers_keep_common_feature_attributes() {
        let mut feature = sample_feature();
        feature.dmcode = 9999;
        feature.geometry_kind = GeometryKind::Line;
        feature.attributes.dmskip = Some(1);
        let projected = ProjectedFeature {
            feature,
            user_id: 7,
            points: vec![],
            decoration: None,
        };
        let mut layers = BTreeMap::new();

        add_tile_layer_feature(&mut layers, "dm_9999_line", Arc::new(projected));

        let features = layers.get("dm_9999_line").unwrap();
        assert_eq!(features.len(), 1);
        assert_eq!(features[0].feature.dmcode, 9999);
        assert_eq!(features[0].feature.attributes.dmskip, Some(1));
    }

    #[test]
    fn encoded_features_include_dm_attributes() {
        let mut feature = sample_feature();
        feature.attributes.dmattr = Some(12);
        feature.attributes.dmprec = Some(30);
        feature.attributes.dmyymm = Some(1312);
        feature.attributes.dmregion = Some(3);
        feature.attributes.dminfo = Some(42);
        feature.attributes.dmelemid = Some(123);
        feature.attributes.dmattrkind = Some(9);
        feature.attributes.dmupyymm = Some(1401);
        feature.attributes.dmdelyymm = Some(1502);
        feature.attributes.dmattrdata = Some("OWNER=ABC".to_string());
        let projected = ProjectedFeature {
            feature,
            user_id: 7,
            points: vec![Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            }],
            decoration: None,
        };
        let layer = encode_layer(
            TileKey {
                z: MIN_ZOOM,
                x: 1 << (MIN_ZOOM - 1),
                y: 1 << (MIN_ZOOM - 1),
            },
            "dm_9999_point".to_string(),
            vec![&projected],
        )
        .unwrap();

        assert!(layer.keys.contains(&"DMATTR".to_string()));
        assert!(layer.keys.contains(&"DMPREC".to_string()));
        assert!(layer.keys.contains(&"DMYYMM".to_string()));
        assert!(layer.keys.contains(&"DMREGION".to_string()));
        assert!(layer.keys.contains(&"DMINFO".to_string()));
        assert!(layer.keys.contains(&"DMELEMID".to_string()));
        assert!(layer.keys.contains(&"DMATTRKIND".to_string()));
        assert!(layer.keys.contains(&"DMUPYYMM".to_string()));
        assert!(layer.keys.contains(&"DMDELYYMM".to_string()));
        assert!(layer.keys.contains(&"DMATTRDATA".to_string()));
        assert!(
            layer
                .values
                .iter()
                .any(|value| value.string_value.as_deref() == Some("OWNER=ABC"))
        );
    }

    #[test]
    fn feature_tile_distribution_writes_only_dmcode_source_layer() {
        let projected = Arc::new(ProjectedFeature {
            feature: sample_feature(),
            user_id: 7,
            points: vec![Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            }],
            decoration: None,
        });
        let key = TileKey {
            z: MIN_ZOOM,
            x: 1 << (MIN_ZOOM - 1),
            y: 1 << (MIN_ZOOM - 1),
        };
        let mut tiles = BTreeMap::new();

        add_feature_to_tiles(
            &mut tiles,
            &BTreeSet::from([key]),
            "dm_9999_line",
            projected,
        );

        let layers = tiles.get(&key).unwrap();
        let source = layers.get("dm_9999_line").unwrap();
        assert_eq!(source.len(), 1);
        assert_eq!(layers.len(), 1);
    }

    #[test]
    fn pmtiles_tile_weight_counts_tile_overhead_and_features() {
        let feature = Arc::new(ProjectedFeature {
            feature: sample_feature(),
            user_id: 7,
            points: vec![],
            decoration: None,
        });
        let mut layers = BTreeMap::new();
        layers.insert(
            "dm_9999_line".to_string(),
            vec![Arc::clone(&feature), Arc::clone(&feature)],
        );
        layers.insert("dm_9998_line".to_string(), vec![feature]);

        assert_eq!(pmtiles_tile_weight(None), 1.0);
        assert_eq!(pmtiles_tile_weight(Some(&layers)), 4.0);
    }

    #[test]
    fn total_pmtiles_tile_weight_sums_candidate_weights() {
        let feature = Arc::new(ProjectedFeature {
            feature: sample_feature(),
            user_id: 7,
            points: vec![],
            decoration: None,
        });
        let empty_key = TileKey {
            z: MIN_ZOOM,
            x: 0,
            y: 0,
        };
        let feature_key = TileKey {
            z: MIN_ZOOM + 1,
            x: 0,
            y: 0,
        };
        let missing_key = TileKey {
            z: MIN_ZOOM + 1,
            x: 0,
            y: 1,
        };
        let mut tile_feature_layers = BTreeMap::new();
        tile_feature_layers.insert(
            feature_key,
            BTreeMap::from([(
                "dm_9999_line".to_string(),
                vec![Arc::clone(&feature), feature],
            )]),
        );

        assert_eq!(
            total_pmtiles_tile_weight(
                &BTreeSet::from([empty_key, feature_key, missing_key]),
                &tile_feature_layers,
            ),
            5.0
        );
    }

    fn sample_feature() -> Feature {
        Feature {
            source_file: "sample.dm".to_string(),
            source_line: 1,
            plane_rectangular_zone: Some(9),
            map_level: Some(2500),
            dmcode: 1,
            geometry_kind: GeometryKind::Point,
            geometry: Geometry::Point(Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            }),
            attributes: dm_parser::Attributes::default(),
            warnings: Vec::new(),
        }
    }
}
