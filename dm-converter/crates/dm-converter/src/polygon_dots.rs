// © TOMII, Tatsuru

use dm_parser::Coordinate;
use geo::{BoundingRect, Contains, Distance, Euclidean, LineString, Point, Polygon};

/// A north-aligned quincunx grid: equal horizontal/vertical pitch, half-pitch alternate rows.
/// Only centers whose entire circle lies inside the source ring are retained.
pub fn circle_centers(ring: &[Coordinate], pitch: f64, radius: f64) -> Vec<Coordinate> {
    if ring.len() < 3
        || !pitch.is_finite()
        || pitch <= 0.0
        || !radius.is_finite()
        || radius <= 0.0
        || ring.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return Vec::new();
    }
    let polygon = Polygon::new(
        LineString::from(ring.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>()),
        vec![],
    );
    let Some(bounds) = polygon.bounding_rect() else {
        return Vec::new();
    };
    let half = pitch / 2.0;
    let mut centers = Vec::new();
    for row in (bounds.min().y / half).ceil() as i64..=(bounds.max().y / half).floor() as i64 {
        let y = row as f64 * half;
        let offset = row.rem_euclid(2) as f64 * half;
        for column in ((bounds.min().x - offset) / pitch).ceil() as i64
            ..=((bounds.max().x - offset) / pitch).floor() as i64
        {
            let x = column as f64 * pitch + offset;
            let point = Point::new(x, y);
            if polygon.contains(&point) && Euclidean.distance(&point, polygon.exterior()) >= radius
            {
                centers.push(Coordinate { x, y, z: None });
            }
        }
    }
    centers
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ring(points: &[(f64, f64)]) -> Vec<Coordinate> {
        points
            .iter()
            .map(|&(x, y)| Coordinate { x, y, z: None })
            .collect()
    }
    #[test]
    fn spacing_and_alternate_rows_match_the_pdf_and_omit_boundary_circles() {
        let polygon = ring(&[(0., 0.), (3., 0.), (3., 3.), (0., 3.), (0., 0.)]);
        let points = circle_centers(&polygon, 1.5, 0.15);
        let xy: Vec<_> = points.iter().map(|p| (p.x, p.y)).collect();
        assert_eq!(
            xy,
            [
                (0.75, 0.75),
                (2.25, 0.75),
                (1.5, 1.5),
                (0.75, 2.25),
                (2.25, 2.25)
            ]
        );
        let mut reversed = polygon.clone();
        reversed.reverse();
        assert_eq!(
            circle_centers(&reversed, 1.5, 0.15)
                .iter()
                .map(|p| (p.x, p.y))
                .collect::<Vec<_>>(),
            xy
        );
    }
    #[test]
    fn concave_boundaries_and_negative_coordinates_keep_complete_circles_inside() {
        let polygon = ring(&[
            (-3., -3.),
            (0., -3.),
            (0., -1.5),
            (-1.5, -1.5),
            (-1.5, 0.),
            (-3., 0.),
            (-3., -3.),
        ]);
        let points = circle_centers(&polygon, 1.5, 0.15);
        assert_eq!(points.len(), 3);
        assert!(points.iter().all(|p| p.x < -1.5 || p.y < -1.5));
        let narrow = ring(&[(0.74, 0.), (0.76, 0.), (0.76, 3.), (0.74, 3.), (0.74, 0.)]);
        assert!(circle_centers(&narrow, 1.5, 0.15).is_empty());
    }
    #[test]
    fn empty_degenerate_and_invalid_inputs_produce_no_circles() {
        assert!(circle_centers(&[], 1.5, 0.15).is_empty());
        let line = ring(&[(0., 0.), (3., 0.), (0., 0.)]);
        assert!(circle_centers(&line, 1.5, 0.15).is_empty());
        for (pitch, radius) in [
            (0., 0.15),
            (f64::NAN, 0.15),
            (1.5, 0.),
            (1.5, f64::INFINITY),
        ] {
            assert!(circle_centers(&line, pitch, radius).is_empty());
        }
        assert!(circle_centers(&ring(&[(f64::NAN, 0.), (3., 0.), (0., 3.)]), 1.5, 0.15).is_empty());
    }
}
