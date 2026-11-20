// © TOMII, Tatsuru
use crate::{
    gpkg::{DecorationFeature, DecorationLayerKey, LayerKey},
    pattern_context::PatternContext,
    pattern_geometry::{self as geom, Frame},
};
use dm_parser::{Coordinate, Feature, Geometry, GeometryKind};

fn native(f: &Feature) -> bool {
    matches!(f.map_level, Some(250 | 500 | 1000))
}
fn selected(f: &Feature) -> bool {
    let line = matches!(f.geometry, Geometry::LineString(_));
    let polygon = matches!(f.geometry, Geometry::Polygon(_));
    let code = if native(f) {
        matches!(
            f.dmcode,
            4262 | 4265
                | 5202
                | 5211
                | 5212
                | 5226
                | 5231
                | 5232
                | 6101
                | 6102
                | 6110
                | 6111
                | 6112
                | 6113
                | 6121
                | 6122
                | 6123
                | 6131
                | 6132
        )
    } else {
        matches!(f.map_level, Some(2500 | 5000))
            && matches!(f.dmcode, 4265 | 5202 | 5211 | 5226 | 5232)
    };
    (code || crate::enclosure_patterns::supports(f))
        && (if matches!(f.dmcode, 5232 | 6121 | 6122 | 6123) {
            polygon
        } else {
            line
        })
}
pub fn layer_kinds(f: &Feature) -> Option<Vec<GeometryKind>> {
    if !selected(f) {
        return None;
    }
    if f.attributes.dmfigtype == Some(99) {
        return Some(vec![]);
    }
    if matches!(
        f.dmcode,
        5211 | 5212 | 5231 | 6101 | 6102 | 6110 | 6111 | 6112 | 6113
    ) && f.attributes.dmfigtype != Some(11)
    {
        return Some(vec![]);
    }
    if f.dmcode == 5226 && f.attributes.dmfigtype != Some(if native(f) { 11 } else { 12 }) {
        return Some(vec![]);
    }
    if f.dmcode == 4262 && f.attributes.dmfigtype != Some(47) {
        return Some(vec![]);
    }
    let kinds = match f.dmcode {
        6136 => vec![GeometryKind::Line, GeometryKind::Point],
        4262 | 4265 | 5232 | 6122 => vec![GeometryKind::Point],
        5226 => vec![GeometryKind::Point],
        6132 => match f.attributes.dmfigtype {
            Some(26) => vec![GeometryKind::Polygon],
            Some(27) => vec![GeometryKind::Point],
            _ => vec![],
        },
        5211 | 5212 | 5231 | 6110 | 6111 | 6112 | 6113 => {
            vec![GeometryKind::Line, GeometryKind::Point]
        }
        _ => vec![GeometryKind::Line],
    };
    Some(kinds)
}
struct Output<'a> {
    feature: &'a Feature,
    key: &'a LayerKey,
    source: &'a str,
    id: i64,
    rows: Vec<DecorationFeature>,
}
impl Output<'_> {
    fn emit(&mut self, label: &str, geometry: Geometry) {
        let kind = match geometry {
            Geometry::Point(_) => GeometryKind::Point,
            Geometry::Polygon(_) => GeometryKind::Polygon,
            _ => GeometryKind::Line,
        };
        self.rows.push(DecorationFeature {
            key: DecorationLayerKey {
                source: self.key.clone(),
                kind,
            },
            geometry,
            src_layer: self.source.to_string(),
            src_user_id: self.id,
            src_dmfile: self.feature.source_file.clone(),
            src_dmcode: self.feature.dmcode,
            decoration: label.to_string(),
            deco_index: self.rows.len() as i64 + 1,
            angle: None,
        });
    }
    fn line(&mut self, label: &str, points: Vec<Coordinate>) {
        if geom::length(&points) > 1e-9 {
            self.emit(label, Geometry::LineString(points));
        }
    }
    fn point(&mut self, label: &str, p: Coordinate) {
        self.emit(label, Geometry::Point(p));
    }
}
pub fn generate(
    f: &Feature,
    key: &LayerKey,
    source: &str,
    id: i64,
    context: &PatternContext,
) -> Option<Vec<DecorationFeature>> {
    let kinds = layer_kinds(f)?;
    if kinds.is_empty() {
        return Some(vec![]);
    }
    let scale = f.map_level? as f64 / 1000.0;
    let mm = |x: f64| x * scale;
    let mut out = Output {
        feature: f,
        key,
        source,
        id,
        rows: vec![],
    };
    if crate::enclosure_patterns::supports(f) {
        if let Geometry::LineString(points) = &f.geometry {
            for (label, geometry) in crate::enclosure_patterns::generate(f, points, scale) {
                out.emit(label, geometry);
            }
        }
        return Some(out.rows);
    }
    match &f.geometry {
        Geometry::Polygon(ring) => polygon_pattern(&mut out, ring, scale),
        Geometry::LineString(points) => match f.dmcode {
            4262 | 4265 => {
                let pitch = if f.dmcode == 4262 {
                    10.0
                } else if native(f) {
                    20.0
                } else {
                    10.0
                };
                for frame in geom::frames(points, mm(pitch), mm(0.5)) {
                    if f.dmcode == 4262 {
                        out.point("pipe_center_circle", frame.p);
                    } else {
                        // The original paired-circle icon places their centres 0.45 mm
                        // either side of the conductor; the outer diameter is 0.3 mm.
                        for side in [1.0, -1.0] {
                            out.point("power_line_circle", frame.at(0.0, mm(side * 0.45)));
                        }
                    }
                }
            }
            6101 | 6102 => slope_pattern(&mut out, points, context, scale),
            6131 => {
                for frame in geom::frames(points, mm(10.0), mm(0.5)) {
                    for side in [-1.0, 1.0] {
                        out.line(
                            "parallel_fence_tick",
                            vec![frame.at(mm(-0.5), mm(side)), frame.at(mm(0.5), mm(side))],
                        );
                    }
                }
            }
            6132 => guard_pattern(&mut out, points, scale),
            5226 => waterfall_pattern(&mut out, points, context, scale),
            _ => coverage_pattern(&mut out, points, context, scale),
        },
        _ => {}
    }
    Some(out.rows)
}
fn slope_pattern(
    out: &mut Output<'_>,
    points: &[Coordinate],
    context: &PatternContext,
    scale: f64,
) {
    let band = context.band(out.feature);
    let mut distance = 0.5 * scale;
    let end = geom::length(points) - 0.5 * scale;
    let mut index = 0;
    while distance <= end + 1e-9 {
        let Some(frame) = geom::sample(points, distance) else {
            break;
        };
        let width = context.width(out.feature, frame, 1000.0 * scale);
        let Some(width) = width else {
            distance += 0.5 * scale;
            continue;
        };
        let long = width.clamp(scale, 10.0 * scale);
        let length =
            (long * if index % 2 == 0 { 1.0 } else { 0.5 }).min((width - 1e-10 * scale).max(0.0));
        let path = vec![frame.p, frame.at(0.0, length)];
        if band
            .as_ref()
            .is_some_and(|ring| geom::contains_path(ring, &path))
        {
            out.line("slope_hachure", path);
        }
        index += 1;
        distance += long / 2.0;
    }
}
struct CoverageLayout {
    size: f64,
    pitch: f64,
    margin: f64,
    square: bool,
}
fn coverage_layout(f: &Feature, projected: bool) -> CoverageLayout {
    let (size, pitch, margin) = match f.dmcode {
        5202 | 5211 | 5231 if native(f) => (1.0, 4.0, 1.0),
        6112 if projected => (0.5, 6.0, 2.0),
        6112 => (0.5, 5.0, 1.0),
        5212 | 6111 if projected => (1.0, 6.0, 2.0),
        5212 | 6111 => (1.0, 5.0, 1.0),
        6113 => (1.0, 1.0, if projected { 2.0 } else { 1.0 }),
        _ => (0.4, 2.0, 0.3),
    };
    CoverageLayout {
        size,
        pitch,
        margin,
        square: f.dmcode == 6112,
    }
}
fn coverage_pattern(
    out: &mut Output<'_>,
    points: &[Coordinate],
    context: &PatternContext,
    scale: f64,
) {
    let projected = geom::frames(points, scale, 0.5 * scale)
        .iter()
        .any(|&frame| context.width(out.feature, frame, 1000.0 * scale).is_some());
    let layout = coverage_layout(out.feature, projected);
    for frame in geom::frames(points, layout.pitch * scale, layout.margin * scale) {
        let d = layout.size * scale;
        if layout.square {
            out.line(
                "coverage_square",
                vec![
                    frame.at(-d / 2.0, 0.0),
                    frame.at(-d / 2.0, d),
                    frame.at(d / 2.0, d),
                    frame.at(d / 2.0, 0.0),
                ],
            );
        } else {
            out.line("coverage_semicircle", geom::semicircle(frame, d, false));
        }
    }
    coverage_fill(out, points, context, scale);
}
fn coverage_fill(
    out: &mut Output<'_>,
    points: &[Coordinate],
    context: &PatternContext,
    scale: f64,
) {
    let f = out.feature;
    let code = f.dmcode;
    let is_native = native(f);
    let large_fill = matches!(code, 5212 | 6111 | 6112 | 6113);
    let coarse_fill = code == 6110 || (code == 5211 && !is_native);
    if !(large_fill || coarse_fill) {
        return;
    }
    let Some(ring) = context.band(f) else {
        return;
    };
    let polygon = geom::polygon(&ring);
    use geo::{Contains, Distance, Euclidean, Point};
    let diameter = if large_fill { 0.6 } else { 0.3 };
    let pitch = if large_fill {
        3.0 * std::f64::consts::SQRT_2
    } else {
        1.5
    };
    use geo::BoundingRect;
    let Some(bounds) = polygon.bounding_rect() else {
        return;
    };
    let max_depth = (bounds.width().hypot(bounds.height()) / scale).min(1000.0);
    let mut row = 0;
    let mut depth = if large_fill { 1.0 } else { 1.5 };
    while depth < max_depth {
        let phase = if row % 2 == 0 { 0.5 } else { 0.5 + pitch / 2.0 };
        for frame in geom::frames(points, pitch * scale, phase * scale) {
            if let Some(width) = context.width(f, frame, 1000.0 * scale)
                && width / scale > 1.0
                && depth + diameter / 2.0 + 0.2 <= width / scale
            {
                let p = frame.at(0.0, depth * scale);
                let q = Point::new(p.x, p.y);
                if !polygon.contains(&q)
                    || Euclidean.distance(&q, polygon.exterior()) < diameter * scale / 2.0 - 1e-8
                {
                    continue;
                }
                out.point(
                    if large_fill {
                        "coverage_circle_06"
                    } else {
                        "coverage_circle_03"
                    },
                    p,
                );
            }
        }
        row += 1;
        depth += if large_fill { pitch / 2.0 } else { pitch };
    }
}
fn waterfall_pattern(
    out: &mut Output<'_>,
    points: &[Coordinate],
    context: &PatternContext,
    scale: f64,
) {
    if !native(out.feature) {
        for frame in geom::frames(points, scale, 0.5 * scale) {
            out.point("waterfall_circle_03", frame.p);
        }
        return;
    }
    // Leave 0.01 paper mm between the pen-4 stroke and the large circle.
    for (row, (depth, diameter)) in [(0.26, 0.3), (0.5, 0.2)].into_iter().enumerate() {
        let margin = if row % 2 == 0 { 0.5 } else { 1.0 };
        for frame in geom::frames(points, scale, margin * scale) {
            if context
                .width(out.feature, frame, 1000.0 * scale)
                .is_none_or(|width| (depth + diameter / 2.0) * scale <= width)
            {
                out.point(
                    if diameter == 0.3 {
                        "waterfall_circle_03"
                    } else {
                        "waterfall_circle_02"
                    },
                    frame.at(0.0, depth * scale),
                );
            }
        }
    }
}
fn guard_pattern(out: &mut Output<'_>, points: &[Coordinate], scale: f64) {
    for frame in geom::frames(points, 5.0 * scale, 0.5 * scale) {
        if out.feature.attributes.dmfigtype == Some(26) {
            out.emit(
                "guardrail_semicircle",
                Geometry::Polygon(geom::semicircle(frame, 0.3 * scale, true)),
            );
        } else {
            out.point("guardpipe_circle", frame.p);
        }
    }
}
fn polygon_pattern(out: &mut Output<'_>, ring: &[Coordinate], scale: f64) {
    if out.feature.dmcode == 5232 {
        boundary_circles(out, ring, scale);
    } else {
        interior_marks(out, ring, scale);
    }
}
fn boundary_circles(out: &mut Output<'_>, ring: &[Coordinate], scale: f64) {
    let polygon = geom::polygon(ring);
    use geo::{Contains, Distance, Euclidean, Point};
    let radius = if native(out.feature) { 0.15 } else { 0.25 } * scale;
    for frame in geom::inward_frames(ring, scale, 0.5 * scale) {
        let p = frame.at(0.0, radius);
        let q = Point::new(p.x, p.y);
        if polygon.contains(&q) && Euclidean.distance(&q, polygon.exterior()) >= radius - 1e-8 {
            out.point("inner_boundary_circle", p);
        }
    }
}
fn interior_marks(out: &mut Output<'_>, ring: &[Coordinate], scale: f64) {
    let code = out.feature.dmcode;
    let pitch = 3.0 * std::f64::consts::SQRT_2 * scale;
    let radius = if code == 6122 {
        0.2 * scale
    } else {
        0.001 * scale
    };
    for p in crate::polygon_dots::circle_centers(ring, pitch, radius) {
        if code == 6122 {
            out.point("mortar_dot", p);
            continue;
        }
        let frame = Frame {
            p,
            t: [1.0, 0.0],
            n: [0.0, 1.0],
        };
        let paths = if code == 6121 {
            vec![
                vec![
                    frame.at(-0.5 * scale, -0.5 * scale),
                    frame.at(0.5 * scale, 0.5 * scale),
                ],
                vec![
                    frame.at(-0.5 * scale, 0.5 * scale),
                    frame.at(0.5 * scale, -0.5 * scale),
                ],
            ]
        } else {
            vec![
                vec![frame.at(-scale, 0.0), frame.at(scale, 0.0)],
                vec![
                    frame.at(-0.5 * scale, -0.5 * scale),
                    frame.at(-0.5 * scale, 0.5 * scale),
                ],
                vec![
                    frame.at(0.5 * scale, -0.5 * scale),
                    frame.at(0.5 * scale, 0.5 * scale),
                ],
            ]
        };
        if paths.iter().all(|path| geom::contains_path(ring, path)) {
            for path in paths {
                out.line(
                    if code == 6121 {
                        "mesh_cross"
                    } else {
                        "concrete_pair"
                    },
                    path,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dm_parser::Attributes;
    fn feature(code: i64, level: i64, fig: i64, polygon: bool) -> Feature {
        let u = level as f64 / 1000.0;
        let p = |x: f64, y: f64| Coordinate {
            x: x * u,
            y: y * u,
            z: None,
        };
        Feature {
            source_file: "patterns.dm".into(),
            source_line: 1,
            plane_rectangular_zone: Some(9),
            map_level: Some(level),
            dmcode: code,
            geometry_kind: if polygon {
                GeometryKind::Polygon
            } else {
                GeometryKind::Line
            },
            geometry: if polygon {
                Geometry::Polygon(vec![
                    p(0.0, 0.0),
                    p(40.0, 0.0),
                    p(40.0, 12.0),
                    p(0.0, 12.0),
                    p(0.0, 0.0),
                ])
            } else {
                Geometry::LineString(vec![p(0.0, 0.0), p(40.0, 0.0)])
            },
            attributes: Attributes {
                dmfigtype: Some(fig),
                ..Attributes::default()
            },
            warnings: vec![],
        }
    }
    fn paired(f: &Feature, width_mm: f64) -> PatternContext {
        let mut lower = f.clone();
        lower.attributes.dmfigtype = Some(12);
        let u = f.map_level.unwrap() as f64 / 1000.0;
        lower.geometry = Geometry::LineString(vec![
            Coordinate {
                x: 40.0 * u,
                y: -width_mm * u,
                z: None,
            },
            Coordinate {
                x: 0.0,
                y: -width_mm * u,
                z: None,
            },
        ]);
        let mut context = PatternContext::default();
        context.observe(&lower);
        context
    }
    fn rows(f: &Feature, context: &PatternContext) -> Vec<DecorationFeature> {
        generate(f, &LayerKey::from_feature(f), "source", 7, context).unwrap()
    }
    #[test]
    fn all_native_patterns_emit_only_declared_kinds_and_keep_source_identity() {
        for level in [250, 500, 1000] {
            for code in [
                4262, 4265, 5202, 5211, 5212, 5226, 5231, 5232, 6101, 6102, 6110, 6111, 6112, 6113,
                6121, 6122, 6123, 6131, 6132,
            ] {
                let fig = if code == 4262 {
                    47
                } else if code == 6132 {
                    26
                } else {
                    11
                };
                let polygon = matches!(code, 5232 | 6121 | 6122 | 6123);
                let f = feature(code, level, fig, polygon);
                let rows = rows(&f, &paired(&f, 6.0));
                assert!(!rows.is_empty(), "{code}/{level}");
                let kinds = layer_kinds(&f).unwrap();
                for (i, row) in rows.iter().enumerate() {
                    assert!(kinds.contains(&row.key.kind));
                    assert_eq!(row.src_layer, "source");
                    assert_eq!(row.src_user_id, 7);
                    assert_eq!(row.src_dmcode, code);
                    assert_eq!(row.src_dmfile, "patterns.dm");
                    assert_eq!(row.deco_index, i as i64 + 1);
                }
                let mut skipped = f.clone();
                skipped.attributes.dmfigtype = Some(99);
                assert!(self::rows(&skipped, &paired(&skipped, 6.0)).is_empty());
            }
        }
    }
    #[test]
    fn lower_edges_never_emit_upper_edge_decorations() {
        for code in [5211, 5212, 5226, 5231, 6101, 6102, 6110, 6111, 6112, 6113] {
            let f = feature(code, 500, 12, false);
            assert!(rows(&f, &PatternContext::default()).is_empty());
            assert!(layer_kinds(&f).unwrap().is_empty());
        }
    }
    #[test]
    fn power_line_spacing_is_twenty_mm_native_and_ten_mm_coarse() {
        for level in [250, 500, 1000, 2500, 5000] {
            let f = feature(4265, level, 11, false);
            let r = rows(&f, &PatternContext::default());
            let expected = if level <= 1000 { 20.0 } else { 10.0 } * level as f64 / 1000.0;
            let p = |row: &DecorationFeature| {
                if let Geometry::Point(p) = row.geometry {
                    p
                } else {
                    panic!()
                }
            };
            assert!((p(&r[2]).x - p(&r[0]).x - expected).abs() < 1e-9);
        }
    }
    #[test]
    fn hachures_use_real_lower_edge_width_alternate_halves_and_respect_scope() {
        for level in [250, 500, 1000] {
            for code in [6101, 6102] {
                let f = feature(code, level, 11, false);
                let u = level as f64 / 1000.0;
                assert!(rows(&f, &PatternContext::default()).is_empty());
                let r = rows(&f, &paired(&f, 6.0));
                assert_eq!(r.len(), 14);
                for (i, row) in r.iter().enumerate() {
                    let Geometry::LineString(p) = &row.geometry else {
                        panic!()
                    };
                    assert!(
                        (geom::length(p) - if i % 2 == 0 { 6.0 * u } else { 3.0 * u }).abs() < 1e-9
                    );
                    assert!((p[0].x - (0.5 + i as f64 * 3.0) * u).abs() < 1e-9);
                    assert!(p[1].y < 0.0);
                }
                for width in [0.5, 1.0, 20.0] {
                    let r = rows(&f, &paired(&f, width));
                    let Geometry::LineString(p) = &r[0].geometry else {
                        panic!()
                    };
                    assert!((geom::length(p) - width.min(10.0) * u).abs() < 1e-9);
                }
                let mut wrong = f.clone();
                wrong.source_file = "other.dm".into();
                assert!(rows(&wrong, &paired(&f, 6.0)).is_empty());
            }
        }
    }
    #[test]
    fn upper_edge_profiles_and_projection_symbols_have_pdf_dimensions() {
        for (code, diameter, pitch) in [
            (5202, 1.0, 4.0),
            (5211, 1.0, 4.0),
            (5212, 1.0, 5.0),
            (6110, 0.4, 2.0),
            (6111, 1.0, 5.0),
            (6112, 0.5, 5.0),
            (6113, 1.0, 1.0),
        ] {
            let f = feature(code, 1000, 11, false);
            let r = rows(&f, &PatternContext::default());
            let Geometry::LineString(p) = &r[0].geometry else {
                panic!()
            };
            let min = p.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
            let max = p.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
            assert!((max - min - diameter).abs() < 1e-9, "{code}");
            let Geometry::LineString(next) = &r[1].geometry else {
                panic!()
            };
            assert!((next[0].x - p[0].x - pitch).abs() < 1e-9);
        }
        for code in [5212, 6111, 6112, 6113] {
            let f = feature(code, 1000, 11, false);
            let r = rows(&f, &paired(&f, 6.0));
            assert!(r.iter().any(|r| r.decoration == "coverage_circle_06"));
            let Geometry::LineString(p) = &r[0].geometry else {
                panic!()
            };
            assert!(
                (p.last().unwrap().x - p[0].x - if code == 6112 { 0.5 } else { 1.0 }).abs() < 1e-9
            );
        }
    }
    #[test]
    fn guardrail_26_is_filled_semicircle_and_guardpipe_27_is_a_centered_dot() {
        for fig in [26, 27] {
            let f = feature(6132, 1000, fig, false);
            let r = rows(&f, &PatternContext::default());
            assert_eq!(r.len(), 8);
            if fig == 26 {
                let Geometry::Polygon(p) = &r[0].geometry else {
                    panic!()
                };
                assert!((p[16].x - p[0].x - 0.3).abs() < 1e-9);
                assert!((p[8].y + 0.15).abs() < 1e-9);
                assert_eq!(p[0], *p.last().unwrap());
            } else {
                assert!(r.iter().all(|r| r.decoration == "guardpipe_circle"
                    && matches!(r.geometry, Geometry::Point(_))));
            }
        }
        assert!(rows(&feature(6132, 500, 11, false), &PatternContext::default()).is_empty());
    }
    #[test]
    fn parallel_fence_ticks_have_one_mm_length_and_offsets_at_ten_mm_pitch() {
        let f = feature(6131, 1000, 11, false);
        let r = rows(&f, &PatternContext::default());
        assert_eq!(r.len(), 8);
        for row in &r {
            let Geometry::LineString(p) = &row.geometry else {
                panic!()
            };
            assert!((geom::length(p) - 1.0).abs() < 1e-9);
            assert!((p[0].y.abs() - 1.0).abs() < 1e-9);
        }
        let Geometry::LineString(a) = &r[0].geometry else {
            panic!()
        };
        let Geometry::LineString(b) = &r[2].geometry else {
            panic!()
        };
        assert!((b[0].x - a[0].x - 10.0).abs() < 1e-9);
    }
    #[test]
    fn polygon_patterns_stay_inside_reversed_and_concave_rings() {
        for code in [5232, 6121, 6122, 6123] {
            let f = feature(code, 1000, 11, true);
            let original = rows(&f, &PatternContext::default());
            assert!(!original.is_empty());
            let Geometry::Polygon(ring) = &f.geometry else {
                panic!()
            };
            let polygon = geom::polygon(ring);
            use geo::{Contains, Point};
            for row in &original {
                match &row.geometry {
                    Geometry::Point(p) => assert!(polygon.contains(&Point::new(p.x, p.y))),
                    Geometry::LineString(p) => assert!(geom::contains_path(ring, p)),
                    _ => panic!(),
                }
            }
            let mut reversed = f.clone();
            let Geometry::Polygon(p) = &mut reversed.geometry else {
                panic!()
            };
            p.reverse();
            assert_eq!(
                rows(&reversed, &PatternContext::default()).len(),
                original.len()
            );
        }
    }
    #[test]
    fn waterfall_rows_have_two_diameters_and_fit_between_edges() {
        let f = feature(5226, 1000, 11, false);
        let r = rows(&f, &paired(&f, 1.0));
        assert!(r.iter().any(|r| r.decoration == "waterfall_circle_02"));
        assert!(r.iter().any(|r| r.decoration == "waterfall_circle_03"));
        for row in r {
            let Geometry::Point(p) = row.geometry else {
                panic!()
            };
            assert!(p.y < 0.0 && p.y >= -0.85);
        }
    }
    #[test]
    fn correction_patterns_have_paired_circles_two_waterfall_rows_and_concrete_crossbars() {
        for level in [250, 500, 1000, 2500, 5000] {
            let u = level as f64 / 1000.0;
            let f = feature(4265, level, 0, false);
            let r = rows(&f, &PatternContext::default());
            let points: Vec<_> = r
                .iter()
                .map(|r| match r.geometry {
                    Geometry::Point(p) => p,
                    _ => panic!(),
                })
                .collect();
            for pair in points.as_chunks::<2>().0 {
                assert!((pair[0].x - pair[1].x).abs() < 1e-9);
                assert!((pair[0].y / u + 0.45).abs() < 1e-9);
                assert!((pair[1].y / u - 0.45).abs() < 1e-9);
            }
            if level <= 1000 {
                let f = feature(5226, level, 11, false);
                let r = rows(&f, &paired(&f, 6.0));
                assert_eq!(r.len(), 79);
                for r in r {
                    let Geometry::Point(p) = r.geometry else {
                        panic!()
                    };
                    let expected = if r.decoration == "waterfall_circle_03" {
                        -0.26
                    } else {
                        -0.5
                    };
                    assert!((p.y / u - expected).abs() < 1e-9);
                }
                let f = feature(6123, level, 0, true);
                let r = rows(&f, &PatternContext::default());
                for motif in r.as_chunks::<3>().0 {
                    let lengths: Vec<_> = motif
                        .iter()
                        .map(|r| match &r.geometry {
                            Geometry::LineString(p) => geom::length(p) / u,
                            _ => panic!(),
                        })
                        .collect();
                    assert_eq!(lengths.len(), 3);
                    assert!((lengths[0] - 2.0).abs() < 1e-8);
                    assert!((lengths[1] - 1.0).abs() < 1e-8 && (lengths[2] - 1.0).abs() < 1e-8);
                }
                assert_eq!(r.len() % 3, 0);
            } else {
                assert!(
                    rows(&feature(5226, level, 11, false), &PatternContext::default()).is_empty()
                );
                let r = rows(&feature(5226, level, 12, false), &PatternContext::default());
                assert_eq!(r.len(), 40);
                assert!(r.iter().all(|r| r.decoration == "waterfall_circle_03"));
            }
        }
    }
    #[test]
    fn band_fill_and_hachures_do_not_cross_the_closed_lower_edge() {
        use geo::{Contains, Distance, Euclidean, Point};
        for code in [6101, 6110, 6111, 6112, 6113] {
            let f = feature(code, 1000, 11, false);
            let mut lower = f.clone();
            lower.attributes.dmfigtype = Some(12);
            let p = |x, y| Coordinate { x, y, z: None };
            let notch = if code == 6110 { 20.1 } else { 19.8 };
            lower.geometry = Geometry::LineString(vec![
                p(40., -6.),
                p(notch + 0.05, -6.),
                p(notch, -0.4),
                p(notch - 0.05, -6.),
                p(0., -6.),
            ]);
            let ring = vec![
                p(0., 0.),
                p(40., 0.),
                p(40., -6.),
                p(notch + 0.05, -6.),
                p(notch, -0.4),
                p(notch - 0.05, -6.),
                p(0., -6.),
                p(0., 0.),
            ];
            let poly = geom::polygon(&ring);
            let mut c = PatternContext::default();
            c.observe(&lower);
            let r = rows(&f, &c);
            assert!(!r.is_empty());
            for r in r {
                match r.geometry {
                    Geometry::Point(p) => {
                        let q = Point::new(p.x, p.y);
                        assert!(poly.contains(&q));
                        let radius = if code == 6110 { 0.15 } else { 0.3 };
                        assert!(Euclidean.distance(&q, poly.exterior()) >= radius - 1e-8);
                    }
                    Geometry::LineString(p) if r.decoration == "slope_hachure" => {
                        assert!(geom::contains_path(&ring, &p))
                    }
                    _ => {}
                }
            }
        }
    }
    #[test]
    fn unsupported_levels_and_geometry_do_not_override_legacy_patterns() {
        let mut f = feature(6121, 2500, 11, true);
        assert!(layer_kinds(&f).is_none());
        f.map_level = Some(1000);
        f.geometry = Geometry::Point(Coordinate {
            x: 0.0,
            y: 0.0,
            z: None,
        });
        assert!(layer_kinds(&f).is_none());
    }
    #[test]
    fn pipe_polygon_repeats_along_both_banks_at_every_level_and_keeps_end_symbols() {
        for level in [250, 500, 1000, 2500, 5000] {
            let f = feature(4262, level, 11, true);
            let u = level as f64 / 1000.0;
            let rows =
                crate::decorations::generate(&f, &LayerKey::from_feature(&f), "pipe_polygon", 7);
            let pitch = if level <= 1000 { 10.0 } else { 3.0 };
            let diameter = if level <= 1000 { 0.3 } else { 0.2 };
            assert_eq!(
                rows.iter()
                    .filter(|r| r.decoration == "pipe_end_symbol")
                    .count(),
                4
            );
            for bank in [0.0, 12.0] {
                let mut centers = vec![];
                for row in rows.iter().filter(|r| r.decoration == "pipe_symbol") {
                    let Geometry::Polygon(p) = &row.geometry else {
                        panic!()
                    };
                    let end = p[p.len() - 2];
                    let x = (p[0].x + end.x) / 2.0;
                    let y = (p[0].y + end.y) / 2.0;
                    assert!(((p[0].x - end.x).abs() / u - diameter).abs() < 1e-8);
                    if (y / u - bank).abs() < 1e-8 {
                        centers.push(x / u);
                    }
                }
                centers.sort_by(f64::total_cmp);
                assert!(centers.len() >= 4);
                for pair in centers.windows(2) {
                    assert!((pair[1] - pair[0] - pitch).abs() < 1e-8);
                }
            }
        }
    }
}
