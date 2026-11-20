// © TOMII, Tatsuru
use crate::pattern_geometry::Frame;
use dm_parser::{Coordinate, Feature, Geometry};
use rstar::{AABB, RTree, primitives::Line};
use std::{cell::RefCell, collections::BTreeMap};

type ContextKey = (String, i64, Option<i64>, Option<u8>);

#[derive(Default)]
pub struct PatternContext {
    chains: RefCell<BTreeMap<ContextKey, Vec<Vec<Coordinate>>>>,
    paths: BTreeMap<ContextKey, Vec<Vec<Coordinate>>>,
    lower: BTreeMap<ContextKey, RTree<Line<[f64; 2]>>>,
}
impl PatternContext {
    pub fn observe(&mut self, feature: &Feature) {
        if feature.attributes.dmfigtype != Some(12)
            || !matches!(
                feature.dmcode,
                5211 | 5212 | 5226 | 5231 | 6101 | 6102 | 6110 | 6111 | 6112 | 6113
            )
        {
            return;
        }
        if let Geometry::LineString(points) = &feature.geometry {
            if points.len() < 2 {
                return;
            }
            self.chains.get_mut().remove(&Self::key(feature));
            self.paths
                .entry(Self::key(feature))
                .or_default()
                .push(points.clone());
            let tree = self.lower.entry(Self::key(feature)).or_default();
            for p in points.windows(2) {
                if (p[1].x - p[0].x).hypot(p[1].y - p[0].y) > 1e-9 {
                    tree.insert(Line::new([p[0].x, p[0].y], [p[1].x, p[1].y]));
                }
            }
        }
    }
    fn key(f: &Feature) -> ContextKey {
        (
            f.source_file.clone(),
            f.dmcode,
            f.map_level,
            f.plane_rectangular_zone,
        )
    }
    /// Join the upper edge to its nearest lower-edge chain in the same source scope.
    /// End connectors are included, so full circles cannot spill past the two ends.
    pub fn band(&self, feature: &Feature) -> Option<Vec<Coordinate>> {
        let Geometry::LineString(upper) = &feature.geometry else {
            return None;
        };
        if upper.len() < 2 {
            return None;
        }
        let key = Self::key(feature);
        if !self.chains.borrow().contains_key(&key) {
            let paths = join_lower_paths(self.paths.get(&key)?);
            self.chains.borrow_mut().insert(key.clone(), paths);
        }
        let epsilon = feature.map_level.unwrap_or(1000) as f64 / 1000.0 * 1e-4;
        self.chains
            .borrow()
            .get(&key)?
            .iter()
            .filter_map(|lower| band_candidate(upper, lower, epsilon))
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, ring)| ring)
    }
    pub fn width(&self, feature: &Feature, frame: Frame, limit: f64) -> Option<f64> {
        let end = frame.at(0.0, limit);
        let env = AABB::from_corners(
            [frame.p.x.min(end.x) - 1e-8, frame.p.y.min(end.y) - 1e-8],
            [frame.p.x.max(end.x) + 1e-8, frame.p.y.max(end.y) + 1e-8],
        );
        let tree = self.lower.get(&Self::key(feature))?;
        tree.locate_in_envelope_intersecting(&env)
            .filter_map(|line| {
                let v = [line.to[0] - line.from[0], line.to[1] - line.from[1]];
                let delta = [line.from[0] - frame.p.x, line.from[1] - frame.p.y];
                let cross = |a: [f64; 2], b: [f64; 2]| a[0] * b[1] - a[1] * b[0];
                let det = cross(frame.n, v);
                if det.abs() < 1e-10 {
                    return None;
                }
                let d = cross(delta, v) / det;
                let u = cross(delta, frame.n) / det;
                (d > 1e-8 && d <= limit + 1e-8 && (-1e-8..=1.0 + 1e-8).contains(&u)).then_some(d)
            })
            .min_by(f64::total_cmp)
    }
}

fn distance(a: Coordinate, b: Coordinate) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn endpoint_key(p: Coordinate) -> (i64, i64) {
    ((p.x * 1e7).round() as i64, (p.y * 1e7).round() as i64)
}
fn join_orientation(
    a: &[Coordinate],
    b: &[Coordinate],
    degrees: &BTreeMap<(i64, i64), usize>,
) -> Option<(bool, bool)> {
    for (pa, reverse_a) in [(*a.last()?, false), (a[0], true)] {
        if degrees.get(&endpoint_key(pa)) != Some(&2) {
            continue;
        }
        for (pb, reverse_b) in [(b[0], false), (*b.last()?, true)] {
            if distance(pa, pb) < 1e-7 {
                return Some((reverse_a, reverse_b));
            }
        }
    }
    None
}
fn join_lower_paths(paths: &[Vec<Coordinate>]) -> Vec<Vec<Coordinate>> {
    let mut degrees = BTreeMap::new();
    for path in paths {
        for p in [path[0], *path.last().unwrap()] {
            *degrees.entry(endpoint_key(p)).or_insert(0) += 1;
        }
    }
    let mut chains = paths.to_vec();
    let mut i = 0;
    while i < chains.len() {
        let mut j = i + 1;
        while j < chains.len() {
            if let Some((reverse_a, reverse_b)) = join_orientation(&chains[i], &chains[j], &degrees)
            {
                let mut b = chains.remove(j);
                if reverse_a {
                    chains[i].reverse();
                }
                if reverse_b {
                    b.reverse();
                }
                chains[i].extend(b.into_iter().skip(1));
                j = i + 1;
            } else {
                j += 1;
            }
        }
        i += 1;
    }
    chains
}
/// Arc distance of the closest projection, including projections inside a segment.
fn closest_position(points: &[Coordinate], p: Coordinate) -> f64 {
    let mut offset = 0.;
    let mut best = (f64::INFINITY, 0.);
    for pair in points.windows(2) {
        let dx = pair[1].x - pair[0].x;
        let dy = pair[1].y - pair[0].y;
        let len = dx.hypot(dy);
        if len <= 1e-9 {
            continue;
        }
        let t = (((p.x - pair[0].x) * dx + (p.y - pair[0].y) * dy) / (len * len)).clamp(0., 1.);
        let q = Coordinate {
            x: pair[0].x + t * dx,
            y: pair[0].y + t * dy,
            z: None,
        };
        let d = distance(p, q);
        if d < best.0 {
            best = (d, offset + t * len);
        }
        offset += len;
    }
    best.1
}
fn band_candidate(
    upper: &[Coordinate],
    lower: &[Coordinate],
    epsilon: f64,
) -> Option<(f64, Vec<Coordinate>)> {
    use crate::pattern_geometry as geom;
    use geo::{Contains, Point, Validation};
    let first = *upper.first()?;
    let last = *upper.last()?;
    let start = closest_position(lower, last);
    let end = closest_position(lower, first);
    let mut part = geom::line_slice(lower, start.min(end), start.max(end), 1e-9)?;
    if start > end {
        part.reverse();
    }
    let score = distance(last, part[0]) + distance(first, *part.last()?);
    let mut ring = upper.to_vec();
    ring.extend(part);
    ring.push(first);
    ring.dedup_by(|a, b| distance(*a, *b) < 1e-9);
    let polygon = geom::polygon(&ring);
    if !polygon.is_valid() {
        return None;
    }
    let probes = geom::frames(upper, geom::length(upper) / 8., geom::length(upper) / 16.);
    if probes.is_empty()
        || !probes.iter().all(|f| {
            let p = f.at(0., epsilon);
            polygon.contains(&Point::new(p.x, p.y))
        })
    {
        return None;
    }
    Some((score, ring))
}

#[cfg(test)]
mod tests {
    use super::*;
    use dm_parser::{Attributes, Coordinate, GeometryKind};
    fn line(fig: i64, points: &[(f64, f64)]) -> Feature {
        Feature {
            source_file: "same.dm".into(),
            source_line: 1,
            plane_rectangular_zone: Some(9),
            map_level: Some(1000),
            dmcode: 6101,
            geometry_kind: GeometryKind::Line,
            geometry: Geometry::LineString(
                points
                    .iter()
                    .map(|&(x, y)| Coordinate { x, y, z: None })
                    .collect(),
            ),
            attributes: Attributes {
                dmfigtype: Some(fig),
                ..Attributes::default()
            },
            warnings: vec![],
        }
    }
    #[test]
    fn nearest_forward_intersection_is_scoped_by_code_file_level_and_zone() {
        let upper = line(11, &[(0., 0.), (10., 0.)]);
        let frame = crate::pattern_geometry::sample(
            if let Geometry::LineString(p) = &upper.geometry {
                p
            } else {
                panic!()
            },
            5.,
        )
        .unwrap();
        let mut c = PatternContext::default();
        c.observe(&line(12, &[(0., -6.), (10., -6.)]));
        c.observe(&line(12, &[(0., -3.), (10., -3.)]));
        c.observe(&line(12, &[(0., 3.), (10., 3.)]));
        c.observe(&line(12, &[(5., -8.), (5., -9.)]));
        assert_eq!(c.width(&upper, frame, 10.), Some(3.));
        assert_eq!(c.width(&upper, frame, 2.), None);
        for index in 0..4 {
            let mut f = upper.clone();
            match index {
                0 => f.source_file = "other.dm".into(),
                1 => f.dmcode = 6102,
                2 => f.map_level = Some(500),
                _ => f.plane_rectangular_zone = Some(8),
            }
            assert!(c.width(&f, frame, 10.).is_none());
        }
    }
    #[test]
    fn bands_join_split_lower_edges_and_ignore_opposite_sides_and_other_sources() {
        use geo::{Contains, Point};
        let f = line(11, &[(0., 0.), (10., 0.)]);
        let mut c = PatternContext::default();
        c.observe(&line(12, &[(10., -4.), (5., -4.)]));
        c.observe(&line(12, &[(0., -4.), (5., -4.)]));
        c.observe(&line(12, &[(0., 3.), (10., 3.)]));
        let ring = c.band(&f).unwrap();
        let p = crate::pattern_geometry::polygon(&ring);
        assert!(p.contains(&Point::new(1., -3.)) && p.contains(&Point::new(9., -3.)));
        assert!(!p.contains(&Point::new(5., 1.)));
        let mut other = f.clone();
        other.source_file = "other.dm".into();
        assert!(c.band(&other).is_none());
        other.geometry = Geometry::Point(Coordinate {
            x: 0.,
            y: 0.,
            z: None,
        });
        assert!(c.band(&other).is_none());
        assert!(PatternContext::default().band(&f).is_none());
    }
    #[test]
    fn adjacent_lower_edges_are_trimmed_to_the_upper_extent_and_branches_do_not_merge() {
        use geo::{Contains, Point};
        let mut c = PatternContext::default();
        c.observe(&line(12, &[(0., -4.), (10., -4.)]));
        c.observe(&line(12, &[(10., -4.), (20., -4.)]));
        let f = line(11, &[(0., 0.), (10., 0.)]);
        let ring = c.band(&f).unwrap();
        assert!(ring.iter().all(|p| p.x >= 0. && p.x <= 10.));
        assert!(crate::pattern_geometry::polygon(&ring).contains(&Point::new(5., -2.)));
        c.observe(&line(12, &[(10., -4.), (10., -8.)]));
        let ring = c.band(&f).unwrap();
        assert!(ring.iter().all(|p| p.x <= 10. && p.y >= -4.));
        let other = line(11, &[(10., 0.), (20., 0.)]);
        assert!(c.band(&other).unwrap().iter().all(|p| p.x >= 10.));
        let mut crossing = PatternContext::default();
        crossing.observe(&line(12, &[(0., -4.), (5., 2.), (10., -4.)]));
        assert!(crossing.band(&f).is_none());
    }
    #[test]
    fn unrelated_figures_and_degenerate_edges_do_not_enter_the_index() {
        let mut c = PatternContext::default();
        c.observe(&line(11, &[(0., -2.), (10., -2.)]));
        c.observe(&line(12, &[(0., 0.), (0., 0.)]));
        let mut f = line(12, &[]);
        f.geometry = Geometry::Point(Coordinate {
            x: 0.,
            y: 0.,
            z: None,
        });
        c.observe(&f);
        f.dmcode = 1000;
        c.observe(&f);
        let frame = Frame {
            p: Coordinate {
                x: 5.,
                y: 0.,
                z: None,
            },
            t: [1., 0.],
            n: [0., -1.],
        };
        assert!(c.width(&line(11, &[]), frame, 10.).is_none());
    }
}
