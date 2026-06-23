// © TOMII, Tatsuru

use crate::gpkg::{DecorationFeature, DecorationLayerKey, LayerKey};
use dm_parser::{Coordinate, Feature, Geometry, GeometryKind};

const MIN_DECORATION_LENGTH: f64 = 0.01;
const BRIDGE_END_DIAG_LEN_MM: f64 = 0.6;
const PIPE_SYMBOL_INTERVAL_MM: f64 = 3.0;
const PIPE_SYMBOL_DIAMETER_MM: f64 = 0.2;
const PIPE_SYMBOL_ARC_SEGMENTS: usize = 8;

#[derive(Debug, Clone, Copy)]
struct Vec2 {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Copy)]
struct Sample {
    point: Coordinate,
    tangent: Vec2,
}

#[derive(Debug, Clone, Copy)]
struct Segment {
    start: Coordinate,
    tangent: Vec2,
    length: f64,
}

#[derive(Debug, Clone, Copy)]
enum LineDecorationSpec {
    BridgeEnd {
        decoration: &'static str,
        length_mm: f64,
        both_sides: bool,
    },
    LineSymbols {
        decoration: &'static str,
        interval_mm: f64,
        length_mm: f64,
        one_sided_right: bool,
        along_tangent: bool,
    },
    Semicircles {
        decoration: &'static str,
        interval_mm: f64,
        diameter_mm: f64,
    },
}

#[derive(Debug, Clone, Copy)]
struct DecorationDef {
    dmcode: i64,
    kind: GeometryKind,
    specs: fn() -> Vec<LineDecorationSpec>,
}

const DECORATION_DEFS: &[DecorationDef] = &[
    DecorationDef {
        dmcode: 2203,
        kind: GeometryKind::Line,
        specs: bridge_end_specs,
    },
    DecorationDef {
        dmcode: 2204,
        kind: GeometryKind::Line,
        specs: bridge_opening_specs,
    },
    DecorationDef {
        dmcode: 2205,
        kind: GeometryKind::Line,
        specs: footbridge_opening_specs,
    },
    DecorationDef {
        dmcode: 2206,
        kind: GeometryKind::Line,
        specs: bridge_pier_specs,
    },
    DecorationDef {
        dmcode: 4262,
        kind: GeometryKind::Polygon,
        specs: pipe_symbol_specs,
    },
    DecorationDef {
        dmcode: 6140,
        kind: GeometryKind::Line,
        specs: wall_symbol_specs,
    },
];

pub fn decoration_layer_key_for(
    feature: &Feature,
    source_key: &LayerKey,
) -> Option<DecorationLayerKey> {
    if !is_decoration_target(feature) {
        return None;
    }
    Some(DecorationLayerKey {
        source: source_key.clone(),
        kind: decoration_geometry_kind(feature.dmcode),
    })
}

pub fn generate(
    feature: &Feature,
    source_key: &LayerKey,
    source_layer: &str,
    source_user_id: i64,
) -> Vec<DecorationFeature> {
    if !is_decoration_target(feature) {
        return Vec::new();
    }
    let level = feature
        .map_level
        .expect("line decoration target has supported map level");
    let specs = specs_for(feature.dmcode);
    if specs.is_empty() {
        return Vec::new();
    }
    let key = DecorationLayerKey {
        source: source_key.clone(),
        kind: decoration_geometry_kind(feature.dmcode),
    };
    let mut rows = Vec::new();
    for spec in specs {
        match spec {
            LineDecorationSpec::BridgeEnd {
                decoration,
                length_mm,
                both_sides,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(bridge_endpoint_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    decoration,
                    length_mm,
                    both_sides,
                    rows.len() as i64,
                ));
            }
            LineDecorationSpec::LineSymbols {
                decoration,
                interval_mm,
                length_mm,
                one_sided_right,
                along_tangent,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(line_symbol_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    decoration,
                    interval_mm,
                    length_mm,
                    one_sided_right,
                    along_tangent,
                    rows.len() as i64,
                ));
            }
            LineDecorationSpec::Semicircles {
                decoration,
                interval_mm,
                diameter_mm,
            } => {
                if let Geometry::Polygon(points) = &feature.geometry {
                    rows.extend(long_side_semicircle_features(
                        feature,
                        &key,
                        source_layer,
                        source_user_id,
                        points,
                        level,
                        decoration,
                        interval_mm,
                        diameter_mm,
                        rows.len() as i64,
                    ));
                }
            }
        }
    }
    rows
}

fn decoration_geometry_kind(dmcode: i64) -> GeometryKind {
    decoration_def(dmcode)
        .map(|def| def.kind)
        .unwrap_or(GeometryKind::Line)
}

fn is_decoration_target(feature: &Feature) -> bool {
    decoration_def(feature.dmcode).is_some_and(|def| def.kind == feature.geometry_kind)
        && matches!(feature.map_level, Some(2500 | 5000))
        && feature.attributes.dmfigtype != Some(99)
}

fn specs_for(dmcode: i64) -> Vec<LineDecorationSpec> {
    decoration_def(dmcode)
        .map(|def| (def.specs)())
        .unwrap_or_default()
}

fn decoration_def(dmcode: i64) -> Option<&'static DecorationDef> {
    DECORATION_DEFS.iter().find(|def| def.dmcode == dmcode)
}

fn bridge_end_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::BridgeEnd {
        decoration: "bridge_end",
        length_mm: BRIDGE_END_DIAG_LEN_MM,
        both_sides: false,
    }]
}

fn bridge_opening_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::BridgeEnd {
        decoration: "bridge_opening",
        length_mm: 1.0,
        both_sides: false,
    }]
}

fn footbridge_opening_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::BridgeEnd {
        decoration: "footbridge_opening",
        length_mm: 0.6,
        both_sides: true,
    }]
}

fn bridge_pier_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::LineSymbols {
        decoration: "bridge_pier",
        interval_mm: 25.0,
        length_mm: 1.0,
        one_sided_right: true,
        along_tangent: false,
    }]
}

fn pipe_symbol_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::Semicircles {
        decoration: "pipe_symbol",
        interval_mm: PIPE_SYMBOL_INTERVAL_MM,
        diameter_mm: PIPE_SYMBOL_DIAMETER_MM,
    }]
}

fn wall_symbol_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::LineSymbols {
        decoration: "wall_symbol",
        interval_mm: 4.0,
        length_mm: 0.5,
        one_sided_right: true,
        along_tangent: false,
    }]
}

#[allow(clippy::too_many_arguments)]
fn bridge_endpoint_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    length_mm: f64,
    both_sides: bool,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let Some(start) = endpoint_sample(points, true) else {
        return Vec::new();
    };
    let Some(end) = endpoint_sample(points, false) else {
        return Vec::new();
    };
    let diag = mm_to_meter(length_mm, level);
    let mut geometries = vec![
        bridge_end_segment(start.point, start.tangent, 135.0, diag),
        bridge_end_segment(end.point, end.tangent, 45.0, diag),
    ];
    if both_sides {
        geometries.insert(
            1,
            bridge_end_segment(start.point, start.tangent, 225.0, diag),
        );
        geometries.push(bridge_end_segment(end.point, end.tangent, 315.0, diag));
    }
    geometries
        .into_iter()
        .enumerate()
        .filter_map(|(index, geometry)| {
            decoration_feature(
                feature,
                key,
                source_layer,
                source_user_id,
                decoration,
                start_index + index as i64 + 1,
                Geometry::LineString(geometry),
            )
        })
        .collect()
}

fn bridge_end_segment(
    endpoint: Coordinate,
    tangent: Vec2,
    clockwise_degrees: f64,
    length: f64,
) -> Vec<Coordinate> {
    let direction = tangent.rotate_clockwise(clockwise_degrees);
    vec![endpoint, translate(endpoint, direction.scale(length))]
}

#[allow(clippy::too_many_arguments)]
fn line_symbol_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    interval_mm: f64,
    length_mm: f64,
    one_sided_right: bool,
    along_tangent: bool,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let total = line_length(points);
    let interval = mm_to_meter(interval_mm, level);
    let margin = mm_to_meter(0.5, level);
    let len = mm_to_meter(length_mm, level);
    if interval < MIN_DECORATION_LENGTH || total <= margin * 2.0 {
        return Vec::new();
    }
    let mut rows = Vec::new();
    let mut distance = margin;
    while distance <= total - margin {
        if let Some(sample) = sample_at(points, distance) {
            let axis = if along_tangent {
                sample.tangent
            } else if one_sided_right {
                sample.tangent.right_normal()
            } else {
                sample.tangent.left_normal()
            };
            let geometry = if one_sided_right && !along_tangent {
                one_sided_short_line(sample.point, axis, len)
            } else {
                centered_short_line(sample.point, axis, len)
            };
            if let Some(row) = decoration_feature(
                feature,
                key,
                source_layer,
                source_user_id,
                decoration,
                start_index + rows.len() as i64 + 1,
                Geometry::LineString(geometry),
            ) {
                rows.push(row);
            }
        }
        distance += interval;
    }
    rows
}

#[allow(clippy::too_many_arguments)]
fn long_side_semicircle_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    interval_mm: f64,
    diameter_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let interval = mm_to_meter(interval_mm, level);
    let radius = mm_to_meter(diameter_mm, level) / 2.0;
    if interval < MIN_DECORATION_LENGTH || radius < MIN_DECORATION_LENGTH {
        return Vec::new();
    }

    let mut rows = Vec::new();
    let center = polygon_centroid(points);
    for segment in long_side_segments(points) {
        let outside = outside_normal(segment, center);
        for point in long_side_symbol_centers(segment, radius, interval) {
            let geometry = filled_semicircle(point, segment.tangent, outside, radius);
            if let Some(row) = decoration_feature(
                feature,
                key,
                source_layer,
                source_user_id,
                decoration,
                start_index + rows.len() as i64 + 1,
                Geometry::Polygon(geometry),
            ) {
                rows.push(row);
            }
        }
    }
    rows
}

fn long_side_segments(points: &[Coordinate]) -> Vec<Segment> {
    let mut segments = points
        .windows(2)
        .filter_map(|pair| {
            let vector = Vec2::between(pair[0], pair[1]);
            let length = vector.length();
            let tangent = vector.non_zero_normalized()?;
            Some(Segment {
                start: pair[0],
                tangent,
                length,
            })
        })
        .collect::<Vec<_>>();
    segments.sort_by(|left, right| {
        right
            .length
            .partial_cmp(&left.length)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    segments.truncate(2);
    segments
}

fn long_side_symbol_centers(segment: Segment, radius: f64, interval: f64) -> Vec<Coordinate> {
    if segment.length <= radius * 2.0 {
        return Vec::new();
    }
    let half_interval = interval / 2.0;
    let distances = [
        radius,
        segment.length / 2.0 - half_interval,
        segment.length / 2.0 + half_interval,
        segment.length - radius,
    ];
    let mut valid_distances = distances
        .into_iter()
        .filter(|distance| *distance >= radius && *distance <= segment.length - radius)
        .collect::<Vec<_>>();
    valid_distances
        .sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    valid_distances.dedup_by(|left, right| (*left - *right).abs() < MIN_DECORATION_LENGTH);
    valid_distances
        .into_iter()
        .map(|distance| translate(segment.start, segment.tangent.scale(distance)))
        .collect()
}

fn outside_normal(segment: Segment, polygon_center: Coordinate) -> Vec2 {
    let midpoint = translate(segment.start, segment.tangent.scale(segment.length / 2.0));
    let to_center = Vec2::between(midpoint, polygon_center);
    let right = segment.tangent.right_normal();
    if right.dot(to_center) < 0.0 {
        right
    } else {
        segment.tangent.left_normal()
    }
}

fn polygon_centroid(points: &[Coordinate]) -> Coordinate {
    let ring = if points.len() > 1 && points.first() == points.last() {
        &points[..points.len() - 1]
    } else {
        points
    };
    if ring.is_empty() {
        return Coordinate {
            x: 0.0,
            y: 0.0,
            z: None,
        };
    }
    let mut x = 0.0;
    let mut y = 0.0;
    for point in ring {
        x += point.x;
        y += point.y;
    }
    Coordinate {
        x: x / ring.len() as f64,
        y: y / ring.len() as f64,
        z: None,
    }
}

fn filled_semicircle(
    center: Coordinate,
    tangent: Vec2,
    outside: Vec2,
    radius: f64,
) -> Vec<Coordinate> {
    let mut points = (0..=PIPE_SYMBOL_ARC_SEGMENTS)
        .map(|index| {
            let theta = std::f64::consts::PI
                - std::f64::consts::PI * index as f64 / PIPE_SYMBOL_ARC_SEGMENTS as f64;
            translate(
                center,
                tangent
                    .scale(radius * theta.cos())
                    .add(outside.scale(radius * theta.sin())),
            )
        })
        .collect::<Vec<_>>();
    points.push(points[0]);
    points
}

fn decoration_feature(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    decoration: &str,
    deco_index: i64,
    geometry: Geometry,
) -> Option<DecorationFeature> {
    if decoration_geometry_length(&geometry) < MIN_DECORATION_LENGTH {
        return None;
    }
    Some(DecorationFeature {
        key: key.clone(),
        geometry,
        src_layer: source_layer.to_string(),
        src_user_id: source_user_id,
        src_dmfile: feature.source_file.clone(),
        src_dmcode: feature.dmcode,
        decoration: decoration.to_string(),
        deco_index,
        angle: None,
    })
}

fn decoration_geometry_length(geometry: &Geometry) -> f64 {
    match geometry {
        Geometry::LineString(points) | Geometry::Polygon(points) => line_length(points),
        Geometry::Point(_)
        | Geometry::Circle { .. }
        | Geometry::Arc { .. }
        | Geometry::TextPoint(_) => MIN_DECORATION_LENGTH,
    }
}

fn endpoint_sample(points: &[Coordinate], first: bool) -> Option<Sample> {
    if first {
        for pair in points.windows(2) {
            let tangent = Vec2::between(pair[0], pair[1]);
            if let Some(tangent) = tangent.non_zero_normalized() {
                return Some(Sample {
                    point: pair[0],
                    tangent,
                });
            }
        }
    } else {
        for pair in points.windows(2).rev() {
            let tangent = Vec2::between(pair[0], pair[1]);
            if let Some(tangent) = tangent.non_zero_normalized() {
                return Some(Sample {
                    point: pair[1],
                    tangent,
                });
            }
        }
    }
    None
}

fn sample_at(points: &[Coordinate], distance: f64) -> Option<Sample> {
    let mut remaining = distance;
    for pair in points.windows(2) {
        let segment = Vec2::between(pair[0], pair[1]);
        let length = segment.length();
        if length < f64::EPSILON {
            continue;
        }
        if remaining <= length {
            let ratio = remaining / length;
            return Some(Sample {
                point: Coordinate {
                    x: pair[0].x + (pair[1].x - pair[0].x) * ratio,
                    y: pair[0].y + (pair[1].y - pair[0].y) * ratio,
                    z: None,
                },
                tangent: segment.scale(1.0 / length),
            });
        }
        remaining -= length;
    }
    endpoint_sample(points, false)
}

fn centered_short_line(center: Coordinate, normal: Vec2, len: f64) -> Vec<Coordinate> {
    vec![
        translate(center, normal.scale(-len / 2.0)),
        translate(center, normal.scale(len / 2.0)),
    ]
}

fn one_sided_short_line(center: Coordinate, normal: Vec2, len: f64) -> Vec<Coordinate> {
    vec![center, translate(center, normal.scale(len))]
}

fn line_length(points: &[Coordinate]) -> f64 {
    points
        .windows(2)
        .map(|pair| Vec2::between(pair[0], pair[1]).length())
        .sum()
}

fn mm_to_meter(mm: f64, level: i64) -> f64 {
    mm * level as f64 / 1000.0
}

fn translate(point: Coordinate, vector: Vec2) -> Coordinate {
    Coordinate {
        x: point.x + vector.x,
        y: point.y + vector.y,
        z: None,
    }
}

impl Vec2 {
    fn between(start: Coordinate, end: Coordinate) -> Self {
        Self {
            x: end.x - start.x,
            y: end.y - start.y,
        }
    }

    fn length(self) -> f64 {
        self.x.hypot(self.y)
    }

    fn non_zero_normalized(self) -> Option<Self> {
        let length = self.length();
        if length < f64::EPSILON {
            None
        } else {
            Some(self.scale(1.0 / length))
        }
    }

    fn normalized(self) -> Self {
        self.non_zero_normalized()
            .unwrap_or(Self { x: 1.0, y: 0.0 })
    }

    fn scale(self, factor: f64) -> Self {
        Self {
            x: self.x * factor,
            y: self.y * factor,
        }
    }

    fn add(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }

    fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y
    }

    fn rotate_clockwise(self, degrees: f64) -> Self {
        let tangent = self.normalized();
        let right = tangent.right_normal();
        let radians = degrees.to_radians();
        Self {
            x: tangent.x * radians.cos() + right.x * radians.sin(),
            y: tangent.y * radians.cos() + right.y * radians.sin(),
        }
        .normalized()
    }

    fn left_normal(self) -> Self {
        Self {
            x: -self.y,
            y: self.x,
        }
    }

    fn right_normal(self) -> Self {
        Self {
            x: self.y,
            y: -self.x,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dm_parser::Attributes;

    fn line_feature(dmcode: i64) -> Feature {
        Feature {
            source_file: "sample.dm".to_string(),
            source_line: 1,
            plane_rectangular_zone: Some(8),
            map_level: Some(2500),
            dmcode,
            geometry_kind: GeometryKind::Line,
            geometry: Geometry::LineString(vec![
                Coordinate {
                    x: 0.0,
                    y: 0.0,
                    z: None,
                },
                Coordinate {
                    x: 100.0,
                    y: 0.0,
                    z: None,
                },
            ]),
            attributes: Attributes::default(),
            warnings: Vec::new(),
        }
    }

    fn polygon_feature(dmcode: i64) -> Feature {
        Feature {
            source_file: "sample.dm".to_string(),
            source_line: 1,
            plane_rectangular_zone: Some(8),
            map_level: Some(2500),
            dmcode,
            geometry_kind: GeometryKind::Polygon,
            geometry: Geometry::Polygon(vec![
                Coordinate {
                    x: 0.0,
                    y: 0.0,
                    z: None,
                },
                Coordinate {
                    x: 100.0,
                    y: 0.0,
                    z: None,
                },
                Coordinate {
                    x: 100.0,
                    y: 10.0,
                    z: None,
                },
                Coordinate {
                    x: 0.0,
                    y: 10.0,
                    z: None,
                },
                Coordinate {
                    x: 0.0,
                    y: 0.0,
                    z: None,
                },
            ]),
            attributes: Attributes::default(),
            warnings: Vec::new(),
        }
    }

    #[test]
    fn generates_footbridge_openings_without_line_symbols() {
        let feature = line_feature(2205);
        let key = LayerKey::from_feature(&feature);
        let rows = generate(&feature, &key, "dm_2205_line_08_2500", 7);
        assert_eq!(rows.len(), 4);
        assert!(
            rows.iter()
                .any(|row| row.decoration == "footbridge_opening")
        );
        assert!(!rows.iter().any(|row| row.decoration == "line_symbol"));
        assert!(rows.iter().all(|row| row.src_user_id == 7));

        let start_lower = line_points(&rows[0].geometry);
        assert_coordinate(start_lower[0], 0.0, 0.0);
        assert_coordinate(start_lower[1], -1.0606601717798212, -1.0606601717798214);

        let start_upper = line_points(&rows[1].geometry);
        assert_coordinate(start_upper[0], 0.0, 0.0);
        assert_coordinate(start_upper[1], -1.0606601717798214, 1.0606601717798212);

        let end_lower = line_points(&rows[2].geometry);
        assert_coordinate(end_lower[0], 100.0, 0.0);
        assert_coordinate(end_lower[1], 101.06066017177982, -1.0606601717798212);

        let end_upper = line_points(&rows[3].geometry);
        assert_coordinate(end_upper[0], 100.0, 0.0);
        assert_coordinate(end_upper[1], 101.06066017177982, 1.0606601717798214);
    }

    #[test]
    fn generates_bridge_end_single_segments_from_endpoints() {
        let feature = line_feature(2203);
        let key = LayerKey::from_feature(&feature);
        let rows = generate(&feature, &key, "dm_2203_line_08_2500", 1);
        assert_eq!(rows.len(), 2);

        let first_points = line_points(&rows[0].geometry);
        assert_eq!(first_points.len(), 2);
        assert_coordinate(first_points[0], 0.0, 0.0);
        assert_coordinate(first_points[1], -1.0606601717798212, -1.0606601717798214);
        assert_length(first_points, 1.5);

        let last_points = line_points(&rows[1].geometry);
        assert_eq!(last_points.len(), 2);
        assert_coordinate(last_points[0], 100.0, 0.0);
        assert_coordinate(last_points[1], 101.06066017177982, -1.0606601717798212);
        assert_length(last_points, 1.5);
    }

    #[test]
    fn scales_bridge_end_length_by_map_level() {
        let mut feature = line_feature(2203);
        feature.map_level = Some(5000);
        let key = LayerKey::from_feature(&feature);
        let rows = generate(&feature, &key, "dm_2203_line_08_5000", 1);

        let first_points = line_points(&rows[0].geometry);
        assert_length(first_points, 3.0);
    }

    #[test]
    fn generates_pipe_symbols_on_two_long_sides() {
        let feature = polygon_feature(4262);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Polygon
        );
        let rows = generate(&feature, &key, "dm_4262_polygon_08_2500", 1);
        assert_eq!(rows.len(), 8);
        assert!(rows.iter().all(|row| row.decoration == "pipe_symbol"));
        assert_eq!(rows[0].key.kind, GeometryKind::Polygon);

        let first_points = polygon_points(&rows[0].geometry);
        assert_eq!(first_points.len(), PIPE_SYMBOL_ARC_SEGMENTS + 2);
        assert_coordinate(first_points[0], 0.0, 0.0);
        assert_coordinate(first_points[4], 0.25, -0.25);
        assert_coordinate(first_points[8], 0.5, 0.0);
        assert_eq!(first_points.first(), first_points.last());

        let second_points = polygon_points(&rows[1].geometry);
        assert_coordinate(second_points[4], 46.25, -0.25);

        let bottom_end_points = polygon_points(&rows[3].geometry);
        assert_coordinate(bottom_end_points[0], 99.5, 0.0);
        assert_coordinate(bottom_end_points[4], 99.75, -0.25);
        assert_coordinate(bottom_end_points[8], 100.0, 0.0);

        let top_start_points = polygon_points(&rows[4].geometry);
        assert_coordinate(top_start_points[0], 100.0, 10.0);
        assert_coordinate(top_start_points[4], 99.75, 10.25);
        assert_coordinate(top_start_points[8], 99.5, 10.0);
    }

    #[test]
    fn polygon_centroid_ignores_duplicate_closing_point() {
        let points = [
            Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            },
            Coordinate {
                x: 6.0,
                y: 0.0,
                z: None,
            },
            Coordinate {
                x: 0.0,
                y: 3.0,
                z: None,
            },
            Coordinate {
                x: 0.0,
                y: 0.0,
                z: None,
            },
        ];

        let centroid = polygon_centroid(&points);
        assert_coordinate(centroid, 2.0, 1.0);
    }

    #[test]
    fn generates_wall_symbols_on_the_right_side() {
        let feature = line_feature(6140);
        let key = LayerKey::from_feature(&feature);
        let rows = generate(&feature, &key, "dm_6140_line_08_2500", 1);
        assert!(rows.iter().all(|row| row.decoration == "wall_symbol"));

        let first_points = line_points(&rows[0].geometry);
        assert_coordinate(first_points[0], 1.25, 0.0);
        assert_coordinate(first_points[1], 1.25, -1.25);
        assert_length(first_points, 1.25);
    }

    #[test]
    fn skips_decorations_outside_supported_map_levels() {
        let mut feature = line_feature(2205);
        feature.map_level = Some(10000);
        let key = LayerKey::from_feature(&feature);
        assert!(decoration_layer_key_for(&feature, &key).is_none());
        assert!(generate(&feature, &key, "dm_2205_line_08_10000", 1).is_empty());
    }

    #[test]
    fn skips_decorations_for_dmfigtype_99() {
        let mut feature = line_feature(2203);
        feature.attributes.dmfigtype = Some(99);
        let key = LayerKey::from_feature(&feature);
        assert!(decoration_layer_key_for(&feature, &key).is_none());
        assert!(generate(&feature, &key, "dm_2203_line_08_2500", 1).is_empty());
    }

    fn line_points(geometry: &Geometry) -> &[Coordinate] {
        match geometry {
            Geometry::LineString(points) => points,
            _ => panic!("expected line string"),
        }
    }

    fn polygon_points(geometry: &Geometry) -> &[Coordinate] {
        match geometry {
            Geometry::Polygon(points) => points,
            _ => panic!("expected polygon"),
        }
    }

    fn assert_coordinate(actual: Coordinate, x: f64, y: f64) {
        assert!((actual.x - x).abs() < 1.0e-9, "x: {}", actual.x);
        assert!((actual.y - y).abs() < 1.0e-9, "y: {}", actual.y);
    }

    fn assert_length(points: &[Coordinate], expected: f64) {
        let length = Vec2::between(points[0], points[1]).length();
        assert!((length - expected).abs() < 1.0e-9, "length: {length}");
    }
}
