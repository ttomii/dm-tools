// © TOMII, Tatsuru

use crate::gpkg::{DecorationFeature, DecorationLayerKey, LayerKey};
use dm_parser::{Coordinate, Feature, Geometry, GeometryKind};

const MIN_DECORATION_LENGTH: f64 = 0.01;
const BRIDGE_END_DIAG_LEN_MM: f64 = 0.6;
const MAJOR_DASH_Y_BRANCH_LEN_MM: f64 = 0.5;
const MAJOR_DASH_LENGTH_MM: f64 = 5.0;
const MINOR_DASH_LENGTH_MM: f64 = 0.4;
const MAJOR_TO_MINOR_DASH_GAP_MM: f64 = 1.3;
const MAJOR_DASH_CYCLE_MM: f64 = 8.0;
const PIPE_SYMBOL_INTERVAL_MM: f64 = 3.0;
const PIPE_SYMBOL_DIAMETER_MM: f64 = 0.2;
const PIPE_SYMBOL_ARC_SEGMENTS: usize = 8;
const CODE_6110_SEMICIRCLE_INTERVAL_MM: f64 = 2.0;
const CODE_6110_SEMICIRCLE_DIAMETER_MM: f64 = 0.4;
const ATTACHED_TRIANGLE_INTERVAL_MM: f64 = 10.0;
const ATTACHED_TRIANGLE_BASE_MM: f64 = 0.8;
const ATTACHED_TRIANGLE_SIDE_MM: f64 = 0.5;
const CODE_6130_DASH_LENGTH_MM: f64 = 2.0;
const CODE_6130_CYCLE_MM: f64 = 3.5;
const CODE_6130_CIRCLE_OFFSET_MM: f64 = 2.75;
const CODE_7105_7107_TICK_INTERVAL_MM: f64 = 3.0;
const CODE_7105_7107_TICK_LENGTH_MM: f64 = 0.5;
const CODE_7212_SYMBOL_INTERVAL_MM: f64 = 1.5;
const CODE_7212_SYMBOL_WIDTH_MM: f64 = 1.5;
const CODE_7212_SYMBOL_HEIGHT_MM: f64 = 0.75;
const CODE_7212_CENTER_LINE_LENGTH_MM: f64 = 0.5;

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
    MajorDashEnds {
        major_decoration: &'static str,
        minor_decoration: &'static str,
        end_decoration: &'static str,
        branch_length_mm: f64,
        dash_length_mm: f64,
        minor_dash_length_mm: f64,
        major_to_minor_gap_mm: f64,
        cycle_mm: f64,
    },
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
    AttachedTriangles {
        decoration: &'static str,
        interval_mm: f64,
        base_mm: f64,
        side_mm: f64,
    },
    Semicircles {
        decoration: &'static str,
        interval_mm: f64,
        diameter_mm: f64,
    },
    LineSemicircles {
        decoration: &'static str,
        dmfigtype: i64,
        interval_mm: f64,
        diameter_mm: f64,
    },
    PointSymbols {
        decoration: &'static str,
        interval_mm: f64,
        offset_mm: f64,
    },
    DashSegments {
        decoration: &'static str,
        dash_length_mm: f64,
        cycle_mm: f64,
    },
    ArcLineSymbols {
        arc_decoration: &'static str,
        center_decoration: &'static str,
        interval_mm: f64,
        width_mm: f64,
        height_mm: f64,
        center_line_length_mm: f64,
    },
}

#[derive(Debug, Clone, Copy)]
struct DecorationDef {
    dmcode: i64,
    source_kind: GeometryKind,
    specs: fn() -> Vec<LineDecorationSpec>,
}

const DECORATION_DEFS: &[DecorationDef] = &[
    DecorationDef {
        dmcode: 1101,
        source_kind: GeometryKind::Line,
        specs: major_dash_end_specs,
    },
    DecorationDef {
        dmcode: 2203,
        source_kind: GeometryKind::Line,
        specs: bridge_end_specs,
    },
    DecorationDef {
        dmcode: 2204,
        source_kind: GeometryKind::Line,
        specs: bridge_opening_specs,
    },
    DecorationDef {
        dmcode: 2205,
        source_kind: GeometryKind::Line,
        specs: footbridge_opening_specs,
    },
    DecorationDef {
        dmcode: 2206,
        source_kind: GeometryKind::Line,
        specs: bridge_pier_specs,
    },
    DecorationDef {
        dmcode: 2305,
        source_kind: GeometryKind::Line,
        specs: perpendicular_tick_specs,
    },
    DecorationDef {
        dmcode: 2306,
        source_kind: GeometryKind::Line,
        specs: attached_triangle_specs,
    },
    DecorationDef {
        dmcode: 4262,
        source_kind: GeometryKind::Polygon,
        specs: pipe_symbol_specs,
    },
    DecorationDef {
        dmcode: 6102,
        source_kind: GeometryKind::Line,
        specs: code_6102_perpendicular_tick_specs,
    },
    DecorationDef {
        dmcode: 6110,
        source_kind: GeometryKind::Line,
        specs: code_6110_semicircle_specs,
    },
    DecorationDef {
        dmcode: 6130,
        source_kind: GeometryKind::Line,
        specs: code_6130_circle_specs,
    },
    DecorationDef {
        dmcode: 6140,
        source_kind: GeometryKind::Line,
        specs: wall_symbol_specs,
    },
    DecorationDef {
        dmcode: 7105,
        source_kind: GeometryKind::Line,
        specs: code_7105_7107_right_tick_specs,
    },
    DecorationDef {
        dmcode: 7106,
        source_kind: GeometryKind::Line,
        specs: code_7105_7107_right_tick_specs,
    },
    DecorationDef {
        dmcode: 7107,
        source_kind: GeometryKind::Line,
        specs: code_7105_7107_right_tick_specs,
    },
    DecorationDef {
        dmcode: 7212,
        source_kind: GeometryKind::Line,
        specs: code_7212_arc_symbol_specs,
    },
];

#[cfg(test)]
pub fn decoration_layer_key_for(
    feature: &Feature,
    source_key: &LayerKey,
) -> Option<DecorationLayerKey> {
    decoration_layer_keys_for(feature, source_key)
        .into_iter()
        .next()
}

pub fn decoration_layer_keys_for(
    feature: &Feature,
    source_key: &LayerKey,
) -> Vec<DecorationLayerKey> {
    if !is_decoration_target(feature) {
        return Vec::new();
    }
    let mut kinds = Vec::new();
    for spec in specs_for(feature.dmcode) {
        let kind = spec_geometry_kind(&spec);
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    kinds
        .into_iter()
        .map(|kind| DecorationLayerKey {
            source: source_key.clone(),
            kind,
        })
        .collect()
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
    let mut rows = Vec::new();
    for spec in specs {
        let key = DecorationLayerKey {
            source: source_key.clone(),
            kind: spec_geometry_kind(&spec),
        };
        match spec {
            LineDecorationSpec::MajorDashEnds {
                major_decoration,
                minor_decoration,
                end_decoration,
                branch_length_mm,
                dash_length_mm,
                minor_dash_length_mm,
                major_to_minor_gap_mm,
                cycle_mm,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(major_dash_end_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    major_decoration,
                    minor_decoration,
                    end_decoration,
                    branch_length_mm,
                    dash_length_mm,
                    minor_dash_length_mm,
                    major_to_minor_gap_mm,
                    cycle_mm,
                    rows.len() as i64,
                ));
            }
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
            LineDecorationSpec::AttachedTriangles {
                decoration,
                interval_mm,
                base_mm,
                side_mm,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(attached_triangle_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    decoration,
                    interval_mm,
                    base_mm,
                    side_mm,
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
            LineDecorationSpec::LineSemicircles {
                decoration,
                dmfigtype,
                interval_mm,
                diameter_mm,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(line_semicircle_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    decoration,
                    dmfigtype,
                    interval_mm,
                    diameter_mm,
                    rows.len() as i64,
                ));
            }
            LineDecorationSpec::PointSymbols {
                decoration,
                interval_mm,
                offset_mm,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(point_symbol_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    decoration,
                    interval_mm,
                    offset_mm,
                    rows.len() as i64,
                ));
            }
            LineDecorationSpec::DashSegments {
                decoration,
                dash_length_mm,
                cycle_mm,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(dash_segment_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    decoration,
                    dash_length_mm,
                    cycle_mm,
                    rows.len() as i64,
                ));
            }
            LineDecorationSpec::ArcLineSymbols {
                arc_decoration,
                center_decoration,
                interval_mm,
                width_mm,
                height_mm,
                center_line_length_mm,
            } => {
                let Geometry::LineString(points) = &feature.geometry else {
                    continue;
                };
                rows.extend(arc_line_symbol_features(
                    feature,
                    &key,
                    source_layer,
                    source_user_id,
                    points,
                    level,
                    arc_decoration,
                    center_decoration,
                    interval_mm,
                    width_mm,
                    height_mm,
                    center_line_length_mm,
                    rows.len() as i64,
                ));
            }
        }
    }
    rows
}

fn spec_geometry_kind(spec: &LineDecorationSpec) -> GeometryKind {
    match spec {
        LineDecorationSpec::Semicircles { .. } | LineDecorationSpec::LineSemicircles { .. } => {
            GeometryKind::Polygon
        }
        LineDecorationSpec::PointSymbols { .. } => GeometryKind::Point,
        LineDecorationSpec::MajorDashEnds { .. }
        | LineDecorationSpec::BridgeEnd { .. }
        | LineDecorationSpec::LineSymbols { .. }
        | LineDecorationSpec::AttachedTriangles { .. }
        | LineDecorationSpec::DashSegments { .. }
        | LineDecorationSpec::ArcLineSymbols { .. } => GeometryKind::Line,
    }
}

fn is_decoration_target(feature: &Feature) -> bool {
    decoration_def(feature.dmcode).is_some_and(|def| def.source_kind == feature.geometry_kind)
        && is_supported_decoration_level(feature.dmcode, feature.map_level)
        && feature.attributes.dmfigtype != Some(99)
}

fn is_supported_decoration_level(dmcode: i64, level: Option<i64>) -> bool {
    match dmcode {
        1101 | 7105 | 7106 | 7107 | 7212 => {
            matches!(level, Some(500 | 1000 | 2500 | 5000))
        }
        _ => matches!(level, Some(2500 | 5000)),
    }
}

fn specs_for(dmcode: i64) -> Vec<LineDecorationSpec> {
    decoration_def(dmcode)
        .map(|def| (def.specs)())
        .unwrap_or_default()
}

fn decoration_def(dmcode: i64) -> Option<&'static DecorationDef> {
    DECORATION_DEFS.iter().find(|def| def.dmcode == dmcode)
}

fn major_dash_end_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::MajorDashEnds {
        major_decoration: "major_dash",
        minor_decoration: "minor_dash",
        end_decoration: "major_dash_end",
        branch_length_mm: MAJOR_DASH_Y_BRANCH_LEN_MM,
        dash_length_mm: MAJOR_DASH_LENGTH_MM,
        minor_dash_length_mm: MINOR_DASH_LENGTH_MM,
        major_to_minor_gap_mm: MAJOR_TO_MINOR_DASH_GAP_MM,
        cycle_mm: MAJOR_DASH_CYCLE_MM,
    }]
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

fn perpendicular_tick_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::LineSymbols {
        decoration: "perpendicular_tick",
        interval_mm: 5.0,
        length_mm: 0.6,
        one_sided_right: false,
        along_tangent: false,
    }]
}

fn attached_triangle_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::AttachedTriangles {
        decoration: "attached_triangles",
        interval_mm: ATTACHED_TRIANGLE_INTERVAL_MM,
        base_mm: ATTACHED_TRIANGLE_BASE_MM,
        side_mm: ATTACHED_TRIANGLE_SIDE_MM,
    }]
}

fn pipe_symbol_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::Semicircles {
        decoration: "pipe_symbol",
        interval_mm: PIPE_SYMBOL_INTERVAL_MM,
        diameter_mm: PIPE_SYMBOL_DIAMETER_MM,
    }]
}

fn code_6102_perpendicular_tick_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::LineSymbols {
        decoration: "perpendicular_tick_1mm",
        interval_mm: 1.0,
        length_mm: 1.0,
        one_sided_right: false,
        along_tangent: false,
    }]
}

fn code_6110_semicircle_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::LineSemicircles {
        decoration: "right_semicircle",
        dmfigtype: 11,
        interval_mm: CODE_6110_SEMICIRCLE_INTERVAL_MM,
        diameter_mm: CODE_6110_SEMICIRCLE_DIAMETER_MM,
    }]
}

fn code_6130_circle_specs() -> Vec<LineDecorationSpec> {
    vec![
        LineDecorationSpec::DashSegments {
            decoration: "dash_segment",
            dash_length_mm: CODE_6130_DASH_LENGTH_MM,
            cycle_mm: CODE_6130_CYCLE_MM,
        },
        LineDecorationSpec::PointSymbols {
            decoration: "gap_circle",
            interval_mm: CODE_6130_CYCLE_MM,
            offset_mm: CODE_6130_CIRCLE_OFFSET_MM,
        },
    ]
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

fn code_7105_7107_right_tick_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::LineSymbols {
        decoration: "right_perpendicular_tick_0_5mm",
        interval_mm: CODE_7105_7107_TICK_INTERVAL_MM,
        length_mm: CODE_7105_7107_TICK_LENGTH_MM,
        one_sided_right: true,
        along_tangent: false,
    }]
}

fn code_7212_arc_symbol_specs() -> Vec<LineDecorationSpec> {
    vec![LineDecorationSpec::ArcLineSymbols {
        arc_decoration: "right_arc",
        center_decoration: "center_chord",
        interval_mm: CODE_7212_SYMBOL_INTERVAL_MM,
        width_mm: CODE_7212_SYMBOL_WIDTH_MM,
        height_mm: CODE_7212_SYMBOL_HEIGHT_MM,
        center_line_length_mm: CODE_7212_CENTER_LINE_LENGTH_MM,
    }]
}

#[allow(clippy::too_many_arguments)]
fn major_dash_end_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    major_decoration: &str,
    minor_decoration: &str,
    end_decoration: &str,
    branch_length_mm: f64,
    dash_length_mm: f64,
    minor_dash_length_mm: f64,
    major_to_minor_gap_mm: f64,
    cycle_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let total = line_length(points);
    let branch_len = mm_to_meter(branch_length_mm, level);
    let dash_len = mm_to_meter(dash_length_mm, level);
    let minor_dash_len = mm_to_meter(minor_dash_length_mm, level);
    let major_to_minor_gap = mm_to_meter(major_to_minor_gap_mm, level);
    let cycle = mm_to_meter(cycle_mm, level);
    if branch_len < MIN_DECORATION_LENGTH
        || dash_len < MIN_DECORATION_LENGTH
        || minor_dash_len < MIN_DECORATION_LENGTH
        || cycle <= dash_len + major_to_minor_gap + minor_dash_len
    {
        return Vec::new();
    }

    let mut rows = Vec::new();
    let mut dash_start = 0.0;
    while dash_start < total {
        if let Some(geometry) = line_slice(points, dash_start, (dash_start + dash_len).min(total)) {
            if let Some(row) = decoration_feature(
                feature,
                key,
                source_layer,
                source_user_id,
                major_decoration,
                start_index + rows.len() as i64 + 1,
                Geometry::LineString(geometry),
            ) {
                rows.push(row);
            }
        }

        if let Some(sample) = sample_at(points, dash_start) {
            rows.extend(major_dash_end_branches(
                feature,
                key,
                source_layer,
                source_user_id,
                end_decoration,
                start_index + rows.len() as i64,
                sample,
                true,
                branch_len,
            ));
        }

        let dash_end = dash_start + dash_len;
        if dash_end <= total {
            if let Some(sample) = sample_at(points, dash_end) {
                rows.extend(major_dash_end_branches(
                    feature,
                    key,
                    source_layer,
                    source_user_id,
                    end_decoration,
                    start_index + rows.len() as i64,
                    sample,
                    false,
                    branch_len,
                ));
            }
        }

        let minor_start = dash_start + dash_len + major_to_minor_gap;
        if minor_start < total {
            if let Some(geometry) = line_slice(
                points,
                minor_start,
                (minor_start + minor_dash_len).min(total),
            ) {
                if let Some(row) = decoration_feature(
                    feature,
                    key,
                    source_layer,
                    source_user_id,
                    minor_decoration,
                    start_index + rows.len() as i64 + 1,
                    Geometry::LineString(geometry),
                ) {
                    rows.push(row);
                }
            }
        }

        dash_start += cycle;
    }
    rows
}

#[allow(clippy::too_many_arguments)]
fn major_dash_end_branches(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    decoration: &str,
    start_index: i64,
    sample: Sample,
    at_start: bool,
    branch_len: f64,
) -> Vec<DecorationFeature> {
    let angles = if at_start {
        [135.0, 225.0]
    } else {
        [45.0, 315.0]
    };
    angles
        .into_iter()
        .enumerate()
        .filter_map(|(index, angle)| {
            let geometry = bridge_end_segment(sample.point, sample.tangent, angle, branch_len);
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
fn point_symbol_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    interval_mm: f64,
    offset_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let total = line_length(points);
    let interval = mm_to_meter(interval_mm, level);
    let mut distance = mm_to_meter(offset_mm, level);
    if interval < MIN_DECORATION_LENGTH || total < distance {
        return Vec::new();
    }
    let mut rows = Vec::new();
    while distance <= total {
        if let Some(sample) = sample_at(points, distance)
            && let Some(row) = decoration_feature(
                feature,
                key,
                source_layer,
                source_user_id,
                decoration,
                start_index + rows.len() as i64 + 1,
                Geometry::Point(sample.point),
            )
        {
            rows.push(row);
        }
        distance += interval;
    }
    rows
}

#[allow(clippy::too_many_arguments)]
fn dash_segment_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    dash_length_mm: f64,
    cycle_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let total = line_length(points);
    let dash_length = mm_to_meter(dash_length_mm, level);
    let cycle = mm_to_meter(cycle_mm, level);
    if dash_length < MIN_DECORATION_LENGTH || cycle < MIN_DECORATION_LENGTH {
        return Vec::new();
    }
    let mut rows = Vec::new();
    let mut start = 0.0;
    while start < total {
        if let Some(geometry) = line_slice(points, start, (start + dash_length).min(total))
            && let Some(row) = decoration_feature(
                feature,
                key,
                source_layer,
                source_user_id,
                decoration,
                start_index + rows.len() as i64 + 1,
                Geometry::LineString(geometry),
            )
        {
            rows.push(row);
        }
        start += cycle;
    }
    rows
}

#[allow(clippy::too_many_arguments)]
fn arc_line_symbol_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    arc_decoration: &str,
    center_decoration: &str,
    interval_mm: f64,
    width_mm: f64,
    height_mm: f64,
    center_line_length_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let total = line_length(points);
    let interval = mm_to_meter(interval_mm, level);
    let half_width = mm_to_meter(width_mm, level) / 2.0;
    let height = mm_to_meter(height_mm, level);
    let center_len = mm_to_meter(center_line_length_mm, level);
    if interval < MIN_DECORATION_LENGTH
        || half_width < MIN_DECORATION_LENGTH
        || height < MIN_DECORATION_LENGTH
        || center_len < MIN_DECORATION_LENGTH
        || total <= half_width * 2.0
    {
        return Vec::new();
    }

    let mut rows = Vec::new();
    let mut distance = half_width;
    while distance <= total - half_width {
        if let Some(sample) = sample_at(points, distance) {
            rows.extend(arc_line_symbol_rows(
                feature,
                key,
                source_layer,
                source_user_id,
                sample,
                arc_decoration,
                center_decoration,
                half_width,
                height,
                center_len,
                start_index + rows.len() as i64,
            ));
        }
        distance += interval;
    }
    rows
}

#[allow(clippy::too_many_arguments)]
fn arc_line_symbol_rows(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    sample: Sample,
    arc_decoration: &str,
    center_decoration: &str,
    half_width: f64,
    height: f64,
    center_len: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    [
        (arc_decoration, right_arc_line(sample, half_width, height)),
        (
            center_decoration,
            centered_short_line(
                translate(sample.point, sample.tangent.right_normal().scale(height)),
                sample.tangent,
                center_len,
            ),
        ),
    ]
    .into_iter()
    .enumerate()
    .filter_map(|(index, (decoration, geometry))| {
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

fn right_arc_line(sample: Sample, half_width: f64, height: f64) -> Vec<Coordinate> {
    let right = sample.tangent.right_normal();
    (0..=PIPE_SYMBOL_ARC_SEGMENTS)
        .map(|index| {
            let theta = std::f64::consts::PI * index as f64 / PIPE_SYMBOL_ARC_SEGMENTS as f64;
            translate(
                sample.point,
                sample
                    .tangent
                    .scale(half_width * theta.cos())
                    .add(right.scale(height * (1.0 - theta.sin()))),
            )
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn attached_triangle_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    interval_mm: f64,
    base_mm: f64,
    side_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    let total = line_length(points);
    let interval = mm_to_meter(interval_mm, level);
    let margin = mm_to_meter(0.5, level);
    let base = mm_to_meter(base_mm, level);
    let height = mm_to_meter(attached_triangle_height_mm(base_mm, side_mm), level);
    let chain_length = base * 2.0;
    if interval < MIN_DECORATION_LENGTH
        || base < MIN_DECORATION_LENGTH
        || height < MIN_DECORATION_LENGTH
        || total <= margin * 2.0 + chain_length
    {
        return Vec::new();
    }

    let mut rows = Vec::new();
    let mut distance = margin;
    while distance + chain_length <= total - margin {
        if let Some(sample) = sample_at(points, distance) {
            let geometry = attached_triangle_chain(sample, base, height);
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

fn attached_triangle_height_mm(base_mm: f64, side_mm: f64) -> f64 {
    let half_base = base_mm / 2.0;
    (side_mm * side_mm - half_base * half_base).sqrt()
}

fn attached_triangle_chain(sample: Sample, base: f64, height: f64) -> Vec<Coordinate> {
    let tangent = sample.tangent;
    let left = tangent.left_normal();
    let right = tangent.right_normal();
    let p0 = sample.point;
    let p1 = translate(p0, tangent.scale(base));
    let p2 = translate(p0, tangent.scale(base * 2.0));
    let apex1 = translate(p0, tangent.scale(base / 2.0).add(right.scale(height)));
    let apex2 = translate(p0, tangent.scale(base * 1.5).add(left.scale(height)));
    vec![p0, apex1, p1, apex2, p2]
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

#[allow(clippy::too_many_arguments)]
fn line_semicircle_features(
    feature: &Feature,
    key: &DecorationLayerKey,
    source_layer: &str,
    source_user_id: i64,
    points: &[Coordinate],
    level: i64,
    decoration: &str,
    dmfigtype: i64,
    interval_mm: f64,
    diameter_mm: f64,
    start_index: i64,
) -> Vec<DecorationFeature> {
    if feature.attributes.dmfigtype != Some(dmfigtype) {
        return Vec::new();
    }

    let total = line_length(points);
    let interval = mm_to_meter(interval_mm, level);
    let radius = mm_to_meter(diameter_mm, level) / 2.0;
    if interval < MIN_DECORATION_LENGTH || radius < MIN_DECORATION_LENGTH || total <= radius * 2.0 {
        return Vec::new();
    }

    let mut rows = Vec::new();
    let mut distance = radius;
    while distance <= total - radius {
        if let Some(sample) = sample_at(points, distance) {
            let geometry = filled_semicircle(
                sample.point,
                sample.tangent,
                sample.tangent.right_normal(),
                radius,
            );
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
        distance += interval;
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

fn line_slice(points: &[Coordinate], start: f64, end: f64) -> Option<Vec<Coordinate>> {
    if end - start < MIN_DECORATION_LENGTH {
        return None;
    }
    let mut result = Vec::new();
    let mut distance = 0.0;
    for pair in points.windows(2) {
        let segment = Vec2::between(pair[0], pair[1]);
        let length = segment.length();
        if length < f64::EPSILON {
            continue;
        }
        let segment_start = distance;
        let segment_end = distance + length;
        if segment_end < start {
            distance = segment_end;
            continue;
        }
        if segment_start > end {
            break;
        }
        let overlap_start = start.max(segment_start);
        let overlap_end = end.min(segment_end);
        if overlap_end - overlap_start >= MIN_DECORATION_LENGTH {
            push_coordinate(
                &mut result,
                interpolate(pair[0], pair[1], (overlap_start - segment_start) / length),
            );
            push_coordinate(
                &mut result,
                interpolate(pair[0], pair[1], (overlap_end - segment_start) / length),
            );
        }
        distance = segment_end;
    }
    if result.len() >= 2 {
        Some(result)
    } else {
        None
    }
}

fn push_coordinate(points: &mut Vec<Coordinate>, point: Coordinate) {
    if points.last().is_none_or(|last| {
        (last.x - point.x).abs() >= MIN_DECORATION_LENGTH
            || (last.y - point.y).abs() >= MIN_DECORATION_LENGTH
    }) {
        points.push(point);
    }
}

fn interpolate(start: Coordinate, end: Coordinate, ratio: f64) -> Coordinate {
    Coordinate {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        z: None,
    }
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
    fn generates_major_dash_end_branches_for_code_1101() {
        let feature = line_feature(1101);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Line
        );
        let rows = generate(&feature, &key, "dm_1101_line_08_2500", 1);
        assert_eq!(rows.len(), 30);
        assert_eq!(rows[0].decoration, "major_dash");
        assert_eq!(rows[5].decoration, "minor_dash");
        assert!(rows.iter().all(|row| row.src_user_id == 1));

        let first_major_dash = line_points(&rows[0].geometry);
        assert_coordinate(first_major_dash[0], 0.0, 0.0);
        assert_coordinate(first_major_dash[1], 12.5, 0.0);
        assert_length(first_major_dash, 12.5);

        let first_lower = line_points(&rows[1].geometry);
        assert_coordinate(first_lower[0], 0.0, 0.0);
        assert_coordinate(first_lower[1], -0.8838834764831843, -0.8838834764831844);
        assert_length(first_lower, 1.25);

        let first_upper = line_points(&rows[2].geometry);
        assert_coordinate(first_upper[0], 0.0, 0.0);
        assert_coordinate(first_upper[1], -0.8838834764831844, 0.8838834764831843);

        let first_end_lower = line_points(&rows[3].geometry);
        assert_coordinate(first_end_lower[0], 12.5, 0.0);
        assert_coordinate(first_end_lower[1], 13.383883476483184, -0.8838834764831843);

        let first_minor_dash = line_points(&rows[5].geometry);
        assert_coordinate(first_minor_dash[0], 15.75, 0.0);
        assert_coordinate(first_minor_dash[1], 16.75, 0.0);
        assert_length(first_minor_dash, 1.0);

        let second_start_lower = line_points(&rows[7].geometry);
        assert_coordinate(second_start_lower[0], 20.0, 0.0);
        assert_coordinate(
            second_start_lower[1],
            19.116116523516816,
            -0.8838834764831844,
        );
    }

    #[test]
    fn scales_major_dash_end_branches_by_map_level() {
        let mut feature = line_feature(1101);
        feature.map_level = Some(500);
        let key = LayerKey::from_feature(&feature);
        let rows = generate(&feature, &key, "dm_1101_line_08_500", 1);

        assert!(!rows.is_empty());
        let first_points = line_points(&rows[1].geometry);
        assert_length(first_points, 0.25);
    }

    #[test]
    fn skips_code_1101_decorations_outside_supported_map_levels() {
        let mut feature = line_feature(1101);
        feature.map_level = Some(10000);
        let key = LayerKey::from_feature(&feature);
        assert!(decoration_layer_key_for(&feature, &key).is_none());
        assert!(generate(&feature, &key, "dm_1101_line_08_10000", 1).is_empty());
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
    fn generates_code_7105_7107_right_side_perpendicular_ticks() {
        for dmcode in [7105, 7106, 7107] {
            let feature = line_feature(dmcode);
            let key = LayerKey::from_feature(&feature);
            let rows = generate(&feature, &key, "dm_7105_line_08_2500", 1);
            assert!(
                rows.iter()
                    .all(|row| row.decoration == "right_perpendicular_tick_0_5mm")
            );

            let first_points = line_points(&rows[0].geometry);
            assert_coordinate(first_points[0], 1.25, 0.0);
            assert_coordinate(first_points[1], 1.25, -1.25);
            assert_length(first_points, 1.25);

            let second_points = line_points(&rows[1].geometry);
            assert_coordinate(second_points[0], 8.75, 0.0);
            assert_coordinate(second_points[1], 8.75, -1.25);
        }
    }

    #[test]
    fn generates_code_7212_right_side_arc_symbols() {
        let feature = line_feature(7212);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Line
        );

        let rows = generate(&feature, &key, "dm_7212_line_08_2500", 1);
        assert!(!rows.is_empty());
        assert!(rows.iter().all(|row| row.key.kind == GeometryKind::Line));

        let first_arc = line_points(&rows[0].geometry);
        assert_eq!(rows[0].decoration, "right_arc");
        assert_eq!(first_arc.len(), PIPE_SYMBOL_ARC_SEGMENTS + 1);
        assert_coordinate(first_arc[0], 3.75, -1.875);
        assert_coordinate(first_arc[4], 1.875, 0.0);
        assert_coordinate(first_arc[8], 0.0, -1.875);

        let first_center = line_points(&rows[1].geometry);
        assert_eq!(rows[1].decoration, "center_chord");
        assert_coordinate(first_center[0], 1.25, -1.875);
        assert_coordinate(first_center[1], 2.5, -1.875);

        let second_arc = line_points(&rows[2].geometry);
        assert_coordinate(second_arc[0], 7.5, -1.875);
        assert_coordinate(second_arc[4], 5.625, 0.0);
        assert_coordinate(second_arc[8], 3.75, -1.875);
    }

    #[test]
    fn generates_code_6130_gap_circle_points() {
        let feature = line_feature(6130);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_keys_for(&feature, &key)
                .into_iter()
                .map(|key| key.kind)
                .collect::<Vec<_>>(),
            vec![GeometryKind::Line, GeometryKind::Point]
        );

        let rows = generate(&feature, &key, "dm_6130_line_08_2500", 1);
        let dashes = rows
            .iter()
            .filter(|row| row.decoration == "dash_segment")
            .collect::<Vec<_>>();
        let circles = rows
            .iter()
            .filter(|row| row.decoration == "gap_circle")
            .collect::<Vec<_>>();

        assert!(!dashes.is_empty());
        assert!(!circles.is_empty());
        assert!(dashes.iter().all(|row| row.key.kind == GeometryKind::Line));
        assert!(
            circles
                .iter()
                .all(|row| row.key.kind == GeometryKind::Point)
        );

        let first_dash = line_points(&dashes[0].geometry);
        assert_coordinate(first_dash[0], 0.0, 0.0);
        assert_coordinate(first_dash[1], 5.0, 0.0);

        let second_dash = line_points(&dashes[1].geometry);
        assert_coordinate(second_dash[0], 8.75, 0.0);
        assert_coordinate(second_dash[1], 13.75, 0.0);

        assert_coordinate(point_coordinate(&circles[0].geometry), 6.875, 0.0);
        assert_coordinate(point_coordinate(&circles[1].geometry), 15.625, 0.0);
    }

    #[test]
    fn generates_code_2305_centered_perpendicular_ticks() {
        let feature = line_feature(2305);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Line
        );
        let rows = generate(&feature, &key, "dm_2305_line_08_2500", 1);
        assert!(
            rows.iter()
                .all(|row| row.decoration == "perpendicular_tick")
        );

        let first_points = line_points(&rows[0].geometry);
        assert_coordinate(first_points[0], 1.25, -0.75);
        assert_coordinate(first_points[1], 1.25, 0.75);
        assert_length(first_points, 1.5);

        let second_points = line_points(&rows[1].geometry);
        assert_coordinate(second_points[0], 13.75, -0.75);
        assert_coordinate(second_points[1], 13.75, 0.75);
    }

    #[test]
    fn generates_code_6102_one_millimeter_perpendicular_ticks() {
        let feature = line_feature(6102);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Line
        );
        let rows = generate(&feature, &key, "dm_6102_line_08_2500", 1);
        assert!(
            rows.iter()
                .all(|row| row.decoration == "perpendicular_tick_1mm")
        );

        let first_points = line_points(&rows[0].geometry);
        assert_coordinate(first_points[0], 1.25, -1.25);
        assert_coordinate(first_points[1], 1.25, 1.25);
        assert_length(first_points, 2.5);

        let second_points = line_points(&rows[1].geometry);
        assert_coordinate(second_points[0], 3.75, -1.25);
        assert_coordinate(second_points[1], 3.75, 1.25);
    }

    #[test]
    fn generates_code_6110_semicircles_on_the_right_side_for_figtype_11() {
        let mut feature = line_feature(6110);
        feature.attributes.dmfigtype = Some(11);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Polygon
        );
        let rows = generate(&feature, &key, "dm_6110_line_08_2500", 1);
        assert_eq!(rows.len(), 20);
        assert!(rows.iter().all(|row| row.decoration == "right_semicircle"));
        assert!(rows.iter().all(|row| row.key.kind == GeometryKind::Polygon));

        let first_points = polygon_points(&rows[0].geometry);
        assert_eq!(first_points.len(), PIPE_SYMBOL_ARC_SEGMENTS + 2);
        assert_coordinate(first_points[0], 0.0, 0.0);
        assert_coordinate(first_points[4], 0.5, -0.5);
        assert_coordinate(first_points[8], 1.0, 0.0);
        assert_eq!(first_points.first(), first_points.last());

        let second_points = polygon_points(&rows[1].geometry);
        assert_coordinate(second_points[0], 5.0, 0.0);
        assert_coordinate(second_points[4], 5.5, -0.5);
        assert_coordinate(second_points[8], 6.0, 0.0);
    }

    #[test]
    fn skips_code_6110_semicircles_for_non_figtype_11() {
        let mut feature = line_feature(6110);
        feature.attributes.dmfigtype = Some(12);
        let key = LayerKey::from_feature(&feature);
        assert!(generate(&feature, &key, "dm_6110_line_08_2500", 1).is_empty());
    }

    #[test]
    fn generates_code_2306_attached_triangle_sides_without_bases() {
        let feature = line_feature(2306);
        let key = LayerKey::from_feature(&feature);
        assert_eq!(
            decoration_layer_key_for(&feature, &key).unwrap().kind,
            GeometryKind::Line
        );
        let rows = generate(&feature, &key, "dm_2306_line_08_2500", 1);
        assert!(
            rows.iter()
                .all(|row| row.decoration == "attached_triangles")
        );

        let first_points = line_points(&rows[0].geometry);
        assert_coordinate(first_points[0], 1.25, 0.0);
        assert_coordinate(first_points[1], 2.25, -0.75);
        assert_coordinate(first_points[2], 3.25, 0.0);
        assert_coordinate(first_points[3], 4.25, 0.75);
        assert_coordinate(first_points[4], 5.25, 0.0);
        assert_length(&first_points[0..3], 1.25);
        assert_length(&first_points[2..5], 1.25);

        let second_points = line_points(&rows[1].geometry);
        assert_coordinate(second_points[0], 26.25, 0.0);
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

    fn point_coordinate(geometry: &Geometry) -> Coordinate {
        match geometry {
            Geometry::Point(point) => *point,
            _ => panic!("expected point"),
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
