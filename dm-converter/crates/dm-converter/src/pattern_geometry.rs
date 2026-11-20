// © TOMII, Tatsuru
use dm_parser::Coordinate;
use geo::{Contains, LineString, Polygon};

#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub p: Coordinate,
    pub t: [f64; 2],
    pub n: [f64; 2],
}
impl Frame {
    pub fn at(self, along: f64, across: f64) -> Coordinate {
        Coordinate {
            x: self.p.x + self.t[0] * along + self.n[0] * across,
            y: self.p.y + self.t[1] * along + self.n[1] * across,
            z: None,
        }
    }
}
pub fn length(points: &[Coordinate]) -> f64 {
    points
        .windows(2)
        .map(|p| (p[1].x - p[0].x).hypot(p[1].y - p[0].y))
        .sum()
}
pub fn sample(points: &[Coordinate], mut distance: f64) -> Option<Frame> {
    for pair in points.windows(2) {
        let dx = pair[1].x - pair[0].x;
        let dy = pair[1].y - pair[0].y;
        let len = dx.hypot(dy);
        if len <= 1e-9 {
            continue;
        }
        if distance <= len + 1e-9 {
            let t = [dx / len, dy / len];
            return Some(Frame {
                p: Coordinate {
                    x: pair[0].x + t[0] * distance.min(len),
                    y: pair[0].y + t[1] * distance.min(len),
                    z: None,
                },
                t,
                n: [t[1], -t[0]],
            });
        }
        distance -= len;
    }
    None
}
pub fn frames(points: &[Coordinate], pitch: f64, margin: f64) -> Vec<Frame> {
    if pitch <= 0.0 || !pitch.is_finite() {
        return vec![];
    }
    let mut out = vec![];
    let mut d = margin;
    let total = length(points);
    while d <= total - margin + 1e-9 {
        if let Some(frame) = sample(points, d) {
            out.push(frame)
        }
        d += pitch;
    }
    out
}
pub fn semicircle(frame: Frame, diameter: f64, filled: bool) -> Vec<Coordinate> {
    let r = diameter / 2.0;
    let mut points = (0..=16)
        .map(|i| {
            let a = std::f64::consts::PI * i as f64 / 16.0;
            frame.at(-r * a.cos(), r * a.sin())
        })
        .collect::<Vec<_>>();
    if filled {
        points.push(points[0]);
    }
    points
}
pub fn polygon(points: &[Coordinate]) -> Polygon {
    Polygon::new(
        LineString::from(points.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>()),
        vec![],
    )
}
pub fn contains_path(ring: &[Coordinate], path: &[Coordinate]) -> bool {
    polygon(ring).contains(&LineString::from(
        path.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>(),
    ))
}
pub fn inward_frames(ring: &[Coordinate], pitch: f64, margin: f64) -> Vec<Frame> {
    let area = ring
        .windows(2)
        .map(|p| p[0].x * p[1].y - p[1].x * p[0].y)
        .sum::<f64>();
    let mut out = frames(ring, pitch, margin);
    if area > 0.0 {
        for frame in &mut out {
            frame.n[0] = -frame.n[0];
            frame.n[1] = -frame.n[1];
        }
    }
    out
}

pub fn line_slice(
    points: &[Coordinate],
    start: f64,
    end: f64,
    minimum: f64,
) -> Option<Vec<Coordinate>> {
    if end - start < minimum {
        return None;
    }
    let mut result = Vec::new();
    let mut distance = 0.0;
    for pair in points.windows(2) {
        let length = (pair[1].x - pair[0].x).hypot(pair[1].y - pair[0].y);
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
        if overlap_end - overlap_start >= minimum {
            push_coordinate(
                &mut result,
                minimum,
                interpolate(pair[0], pair[1], (overlap_start - segment_start) / length),
            );
            push_coordinate(
                &mut result,
                minimum,
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

fn push_coordinate(points: &mut Vec<Coordinate>, minimum: f64, point: Coordinate) {
    if points.last().is_none_or(|last| {
        (last.x - point.x).abs() >= minimum || (last.y - point.y).abs() >= minimum
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

#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64, y: f64) -> Coordinate {
        Coordinate { x, y, z: None }
    }
    #[test]
    fn frames_follow_arc_length_through_bends_and_ignore_zero_segments() {
        let points = [p(0., 0.), p(0., 0.), p(3., 0.), p(3., 4.)];
        assert_eq!(length(&points), 7.);
        assert_eq!(sample(&points, 2.).unwrap().p, p(2., 0.));
        assert_eq!(sample(&points, 3.).unwrap().n, [0., -1.]);
        let vertical = sample(&points, 4.).unwrap();
        assert_eq!(vertical.p, p(3., 1.));
        assert_eq!(vertical.n, [1., 0.]);
        assert_eq!(
            frames(&points, 2., 0.5)
                .iter()
                .map(|f| f.p)
                .collect::<Vec<_>>(),
            [p(0.5, 0.), p(2.5, 0.), p(3., 1.5), p(3., 3.5)]
        );
        assert!(sample(&points, 8.).is_none());
        assert!(sample(&[], 1.).is_none());
        assert!(frames(&points, 0., 0.5).is_empty());
        assert!(frames(&points, f64::NAN, 0.5).is_empty());
    }
    #[test]
    fn filled_and_open_semicircles_have_the_same_diameter_and_right_side() {
        let f = Frame {
            p: p(0., 0.),
            t: [1., 0.],
            n: [0., -1.],
        };
        let a = semicircle(f, 0.3, false);
        let b = semicircle(f, 0.3, true);
        assert_eq!(a.len(), 17);
        assert_eq!(b.len(), 18);
        assert_eq!(b[0], b[17]);
        assert!((a[16].x - a[0].x - 0.3).abs() < 1e-9);
        assert!((a[8].y + 0.15).abs() < 1e-9);
    }
    #[test]
    fn concave_containment_checks_whole_marks_not_just_endpoints() {
        let ring = [
            p(0., 0.),
            p(3., 0.),
            p(3., 1.),
            p(1., 1.),
            p(1., 3.),
            p(0., 3.),
            p(0., 0.),
        ];
        assert!(!contains_path(&ring, &[p(0.5, 2.5), p(2.5, 0.5)]));
        assert!(contains_path(&ring, &[p(0.5, 0.5), p(2.5, 0.5)]));
        assert!(!inward_frames(&ring, 1., 0.5).is_empty());
    }
}
