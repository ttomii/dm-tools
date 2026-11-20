// © TOMII, Tatsuru
use crate::pattern_geometry as geom;
use dm_parser::{Coordinate, Feature, Geometry};
type Mark = (&'static str, Geometry);

pub fn supports(f: &Feature) -> bool {
    matches!(f.map_level, Some(250 | 500 | 1000))
        && matches!(
            f.dmcode,
            6133 | 6134 | 6136 | 6137 | 6140 | 6141 | 6142 | 7108 | 7199
        )
}
fn line(label: &'static str, points: Vec<Coordinate>) -> Mark {
    (label, Geometry::LineString(points))
}
pub fn generate(f: &Feature, points: &[Coordinate], scale: f64) -> Vec<Mark> {
    if f.dmcode == 6136 {
        return hedge(points, scale);
    }
    if f.dmcode == 7199 {
        return arrow(points, scale);
    }
    if f.dmcode == 7108 {
        return depression(points, scale);
    }
    if f.dmcode == 6133 {
        return screen(points, scale);
    }
    let pitch = match f.dmcode {
        6137 => 2.0,
        6140 | 6141 | 6142 | 6134 => 4.0,
        _ => 5.5,
    };
    geom::frames(
        points,
        pitch * scale,
        if f.dmcode == 7108 {
            2.5 * scale
        } else {
            0.5 * scale
        },
    )
    .into_iter()
    .enumerate()
    .map(|(i, frame)| match f.dmcode {
        6134 => {
            let half = scale / (2.0 * 2.0_f64.sqrt());
            line(
                "fence_cross",
                vec![
                    frame.at(-half, -half),
                    frame.at(half, half),
                    frame.p,
                    frame.at(-half, half),
                    frame.at(half, -half),
                ],
            )
        }
        6137 => line(
            "earth_fence_tick",
            vec![frame.at(0.0, -scale), frame.at(0.0, scale)],
        ),
        _ => {
            let side = if matches!(f.dmcode, 6141 | 6142)
                && f.attributes.dmfigtype == Some(46)
                && i % 2 == 1
            {
                -1.0
            } else {
                1.0
            };
            line(
                if f.dmcode == 7108 {
                    "depression_tick"
                } else {
                    "wall_tick"
                },
                vec![frame.p, frame.at(0.0, side * 0.5 * scale)],
            )
        }
    })
    .collect()
}
fn depression(points: &[Coordinate], scale: f64) -> Vec<Mark> {
    let total = geom::length(points);
    let mut rows = vec![];
    let mut start = 0.0;
    while start < total {
        let end = (start + 5.0 * scale).min(total);
        if let Some(dash) = geom::line_slice(points, start, end, 1e-9) {
            rows.push(line("depression_dash", dash));
            if end - start >= 5.0 * scale - 1e-9
                && let Some(frame) = geom::sample(points, start + 2.5 * scale)
            {
                rows.push(line(
                    "depression_tick",
                    vec![frame.p, frame.at(0.0, 0.5 * scale)],
                ));
            }
        }
        start += 5.5 * scale;
    }
    rows
}

fn screen(points: &[Coordinate], scale: f64) -> Vec<Mark> {
    let total = geom::length(points);
    if total <= 1e-9 {
        return vec![];
    }
    let mut path = vec![points[0]];
    let mut distance = 0.25 * scale;
    let mut i = 0;
    while distance < total - 1e-9 {
        if let Some(frame) = geom::sample(points, distance) {
            let side = if i % 2 == 0 { 1.0 } else { -1.0 };
            path.push(frame.at(0.0, side * 3.0_f64.sqrt() / 4.0 * scale));
        }
        distance += 0.5 * scale;
        i += 1;
    }
    path.push(*points.last().unwrap());
    vec![line("screen_triangle", path)]
}

fn hedge(points: &[Coordinate], scale: f64) -> Vec<Mark> {
    let mut rows = vec![];
    let total = geom::length(points);
    let mut start = 0.0;
    while start + 2.0 * scale <= total + 1e-9 {
        let wave = (0..=32)
            .filter_map(|i| {
                let along = 2.0 * scale * i as f64 / 32.0;
                geom::sample(points, start + along).map(|frame| {
                    frame.at(
                        0.0,
                        0.15 * scale * (std::f64::consts::TAU * i as f64 / 32.0).sin(),
                    )
                })
            })
            .collect();
        rows.push(line("hedge_wave", wave));
        if let Some(frame) = geom::sample(points, start + 3.0 * scale) {
            rows.push(("hedge_dot", Geometry::Point(frame.p)));
        }
        start += 4.0 * scale;
    }
    rows
}
fn arrow(points: &[Coordinate], scale: f64) -> Vec<Mark> {
    let total = geom::length(points);
    if total <= 1e-9 {
        return vec![];
    }
    let Some(frame) = geom::sample(points, total) else {
        return vec![];
    };
    let back = (0.5 * scale).min(total);
    vec![line(
        "depression_arrow",
        vec![
            frame.at(-back, 0.15 * scale),
            frame.p,
            frame.at(-back, -0.15 * scale),
        ],
    )]
}

#[cfg(test)]
mod tests {
    use super::*;
    use dm_parser::{Attributes, GeometryKind};
    fn p(x: f64, y: f64) -> Coordinate {
        Coordinate { x, y, z: None }
    }
    fn feature(code: i64, level: i64, fig: i64) -> Feature {
        Feature {
            source_file: "f.dm".into(),
            source_line: 1,
            plane_rectangular_zone: Some(9),
            map_level: Some(level),
            dmcode: code,
            geometry_kind: GeometryKind::Line,
            geometry: Geometry::LineString(vec![]),
            attributes: Attributes {
                dmfigtype: Some(fig),
                ..Attributes::default()
            },
            warnings: vec![],
        }
    }
    fn path(row: &Mark) -> &Vec<Coordinate> {
        if let Geometry::LineString(p) = &row.1 {
            p
        } else {
            panic!()
        }
    }
    #[test]
    fn native_fences_have_dimensions_and_wall_46_alternates_sides() {
        for level in [250, 500, 1000] {
            let u = level as f64 / 1000.;
            let ps = [p(0., 0.), p(20. * u, 0.)];
            for code in [6133, 6134, 6137, 6140, 6141, 6142, 7108] {
                let f = feature(code, level, 11);
                assert!(supports(&f));
                let rows = generate(&f, &ps, u);
                assert!(!rows.is_empty());
                let a = path(if code == 7108 {
                    rows.iter().find(|r| r.0 == "depression_tick").unwrap()
                } else {
                    &rows[0]
                });
                let size = match code {
                    6133 => 3.0_f64.sqrt() / 2.0,
                    6134 => 1.0 / 2.0_f64.sqrt(),
                    6137 => 2.,
                    _ => 0.5,
                };
                let y = a.iter().map(|p| p.y).collect::<Vec<_>>();
                assert!(
                    (y.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                        - y.iter().copied().fold(f64::INFINITY, f64::min)
                        - size * u)
                        .abs()
                        < 1e-9
                );
                if [6141, 6142].contains(&code) {
                    assert!(path(&rows[1])[1].y < 0.);
                    let both = generate(&feature(code, level, 46), &ps, u);
                    assert!(path(&both[0])[1].y < 0.);
                    assert!(path(&both[1])[1].y > 0.);
                    for pair in both.windows(2) {
                        assert!((path(&pair[1])[0].x - path(&pair[0])[0].x - 4.0 * u).abs() < 1e-9);
                        assert!(path(&pair[0])[1].y * path(&pair[1])[1].y < 0.0);
                    }
                }
            }
        }
        assert!(!supports(&feature(6141, 2500, 46)));
    }
    #[test]
    fn depression_ticks_are_centered_in_each_five_mm_dash() {
        let f = feature(7108, 1000, 11);
        let rows = generate(&f, &[p(0., 0.), p(20., 0.)], 1.);
        let starts = rows
            .iter()
            .filter(|r| r.0 == "depression_tick")
            .map(|r| path(r)[0].x)
            .collect::<Vec<_>>();
        assert_eq!(starts, vec![2.5, 8., 13.5]);
        for row in rows.iter().filter(|r| r.0 == "depression_tick") {
            assert!(path(row)[1].y < 0.);
        }
        let dashes = rows
            .iter()
            .filter(|r| r.0 == "depression_dash")
            .collect::<Vec<_>>();
        assert_eq!(dashes.len(), 4);
        assert_eq!(path(dashes[0]), &vec![p(0., 0.), p(5., 0.)]);
        assert_eq!(path(dashes[3]), &vec![p(16.5, 0.), p(20., 0.)]);
    }
    #[test]
    fn depression_dashes_keep_source_corners_and_clip_the_last_dash() {
        let f = feature(7108, 1000, 11);
        let rows = generate(&f, &[p(0., 0.), p(4., 0.), p(4., 8.)], 1.);
        let dashes = rows
            .iter()
            .filter(|r| r.0 == "depression_dash")
            .collect::<Vec<_>>();
        assert_eq!(path(dashes[0]), &vec![p(0., 0.), p(4., 0.), p(4., 1.)]);
        assert_eq!(path(dashes[2]), &vec![p(4., 7.), p(4., 8.)]);
        assert_eq!(rows.iter().filter(|r| r.0 == "depression_tick").count(), 2);
    }
    #[test]
    fn hedge_waves_and_dots_repeat_in_arc_length() {
        let f = feature(6136, 1000, 11);
        let rows = generate(&f, &[p(0., 0.), p(4., 0.), p(4., 4.)], 1.);
        assert_eq!(rows.len(), 4);
        let a = path(&rows[0]);
        assert_eq!(a.first(), Some(&p(0., 0.)));
        assert!((a.last().unwrap().x - 2.).abs() < 1e-9);
        assert!((a[8].y + 0.15).abs() < 1e-9);
        assert_eq!(rows[1].1, Geometry::Point(p(3., 0.)));
        assert_eq!(rows[3].1, Geometry::Point(p(4., 3.)));
    }
    #[test]
    fn arrow_is_at_final_vertex_follows_final_segment_and_handles_empty_lines() {
        let f = feature(7199, 1000, 11);
        let a = generate(&f, &[p(0., 0.), p(2., 0.), p(2., 3.)], 1.);
        let ps = path(&a[0]);
        assert_eq!(ps[1], p(2., 3.));
        assert!((ps[0].y - 2.5).abs() < 1e-9);
        assert!((ps[0].x - ps[2].x - 0.3).abs() < 1e-9);
        assert!(generate(&f, &[], 1.).is_empty());
    }
}
