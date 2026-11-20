use super::*;
use geo::{LineString, Polygon, Simplify, Validation};
use rstar::{AABB, RTree, primitives::Rectangle};

#[derive(Default)]
pub(super) struct PolygonIndex(BTreeMap<i64, RTree<Rectangle<[f64; 2]>>>);

impl PolygonIndex {
    pub(super) fn read(
        connection: &Connection,
        layers: &[GpkgLayer],
        projector: &Projector,
    ) -> Result<Self, MapLibreError> {
        let mut envelopes: BTreeMap<i64, Vec<Rectangle<[f64; 2]>>> = BTreeMap::new();
        for layer in layers
            .iter()
            .filter(|layer| layer.kind == GeometryKind::Polygon)
        {
            envelopes
                .entry(layer.level)
                .or_default()
                .extend(read_layer_envelopes(connection, layer, projector)?);
        }
        Ok(Self(
            envelopes
                .into_iter()
                .map(|(level, boxes)| (level, RTree::bulk_load(boxes)))
                .collect(),
        ))
    }

    pub(super) fn permits(&self, feature: &ProjectedFeature) -> bool {
        let Some(tree) = feature
            .feature
            .map_level
            .and_then(|level| self.0.get(&level))
        else {
            return false;
        };
        let Some(envelope) = bounds(&feature.points) else {
            return false;
        };
        // Count the feature itself. Keeping every potentially shared boundary unchanged
        // also covers different vertex spacing, source layers, and partial updates.
        tree.locate_in_envelope_intersecting(&envelope)
            .take(2)
            .count()
            == 1
    }
}

fn read_layer_envelopes(
    connection: &Connection,
    layer: &GpkgLayer,
    projector: &Projector,
) -> Result<Vec<Rectangle<[f64; 2]>>, MapLibreError> {
    let mut statement = connection.prepare(&format!(
        "SELECT geom FROM {}",
        quote_identifier(&layer.table_name)
    ))?;
    let mut rows = statement.query([])?;
    let mut envelopes = Vec::new();
    while let Some(row) = rows.next()? {
        let blob: Vec<u8> = row.get(0)?;
        let points = projector.project(layer.zone, &read_geometry(&blob, layer.kind)?)?;
        if let Some(envelope) = bounds(&points) {
            envelopes.push(Rectangle::from_corners(envelope.lower(), envelope.upper()));
        }
    }
    Ok(envelopes)
}

fn bounds(points: &[Coordinate]) -> Option<AABB<[f64; 2]>> {
    let first = points.first()?;
    let (lower, upper) =
        points
            .iter()
            .fold(([first.x, first.y], [first.x, first.y]), |(lo, hi), p| {
                (
                    [lo[0].min(p.x), lo[1].min(p.y)],
                    [hi[0].max(p.x), hi[1].max(p.y)],
                )
            });
    Some(AABB::from_corners(lower, upper))
}

pub(super) fn tolerance(tile: TileKey, feature: &ProjectedFeature) -> f64 {
    // z18 is also the source of overzoomed z19–24, where original detail is needed.
    if tile.z == MAX_ZOOM {
        return 0.0;
    }
    let Some(level) = feature.feature.map_level.filter(|level| *level > 0) else {
        return 0.0;
    };
    // Use the greatest absolute latitude so the whole feature is at a smaller scale.
    let latitude = feature
        .points
        .iter()
        .map(|p| mercator_to_lon_lat(*p).1.abs())
        .fold(0.0_f64, f64::max);
    let scale = 2.0 * WEB_MERCATOR_HALF / (512.0 * 2_f64.powi(i32::from(tile.z)))
        * 96.0
        * 39.37
        * latitude.to_radians().cos();
    if scale > level as f64 {
        SIMPLIFY_TOLERANCE
    } else {
        0.0
    }
}

pub(super) fn polygon(points: &[(i32, i32)], tolerance: f64) -> Vec<(i32, i32)> {
    if tolerance <= 0.0 || points.len() < 4 {
        return points.to_vec();
    }
    let original = as_polygon(points);
    if !original.is_valid() {
        return points.to_vec();
    }
    let candidate = original.simplify(tolerance);
    if !candidate.is_valid() {
        return points.to_vec();
    }
    let mut ring = candidate
        .exterior()
        .0
        .iter()
        .map(|p| (p.x as i32, p.y as i32))
        .collect::<Vec<_>>();
    if ring.first() == ring.last() {
        ring.pop();
    }
    let clipped = clip_polygon(&ring);
    if ring.len() < 3
        || signed_area(&ring) * signed_area(points) <= 0.0
        || (!clipped.is_empty() && !as_polygon(&clipped).is_valid())
    {
        return points.to_vec();
    }
    ring
}

fn as_polygon(points: &[(i32, i32)]) -> Polygon<f64> {
    Polygon::new(
        LineString::from(
            points
                .iter()
                .map(|&(x, y)| (f64::from(x), f64::from(y)))
                .collect::<Vec<_>>(),
        ),
        vec![],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feature(z: u8, kind: GeometryKind, points: &[(i32, i32)]) -> (TileKey, ProjectedFeature) {
        let tile = TileKey {
            z,
            x: 1 << (z - 1),
            y: 1 << (z - 1),
        };
        let unit = 2.0 * WEB_MERCATOR_HALF / (f64::from(EXTENT) * 2_f64.powi(i32::from(z)));
        let projected = points
            .iter()
            .map(|&(x, y)| Coordinate {
                x: f64::from(x) * unit,
                y: -f64::from(y) * unit,
                z: None,
            })
            .collect::<Vec<_>>();
        let mut source = super::super::tests::sample_feature();
        source.geometry_kind = kind;
        source.geometry = geometry_from_points(kind, projected.clone());
        (
            tile,
            ProjectedFeature {
                feature: source,
                user_id: 1,
                points: projected,
                decoration: None,
            },
        )
    }

    fn index(features: &[&ProjectedFeature]) -> PolygonIndex {
        let boxes = features
            .iter()
            .map(|f| {
                let b = bounds(&f.points).unwrap();
                Rectangle::from_corners(b.lower(), b.upper())
            })
            .collect();
        PolygonIndex(BTreeMap::from([(2500, RTree::bulk_load(boxes))]))
    }

    #[test]
    fn scale_gate_uses_level_and_latitude_and_preserves_overzoom_source() {
        let (tile, mut input) = feature(
            16,
            GeometryKind::Line,
            &[(100, 100), (200, 101), (300, 100)],
        );
        assert_eq!(tolerance(tile, &input), 4.0);
        input.feature.map_level = Some(5000);
        assert_eq!(tolerance(tile, &input), 0.0);
        input.feature.map_level = Some(2500);
        for p in &mut input.points {
            p.y = 6_378_137.0
                * (std::f64::consts::FRAC_PI_4 + 60_f64.to_radians() / 2.0)
                    .tan()
                    .ln();
        }
        assert_eq!(tolerance(tile, &input), 0.0);
        input.feature.map_level = None;
        assert_eq!(tolerance(tile, &input), 0.0);
        input.feature.map_level = Some(0);
        assert_eq!(tolerance(tile, &input), 0.0);
        input.feature.map_level = Some(250);
        assert_eq!(tolerance(TileKey { z: 18, ..tile }, &input), 0.0);
    }

    #[test]
    fn lines_and_isolated_polygons_are_simplified_only_at_smaller_scales() {
        for (z, expected_line, expected_polygon) in [(13, 2, 4), (17, 3, 5), (18, 3, 5)] {
            let (tile, line) =
                feature(z, GeometryKind::Line, &[(100, 100), (200, 101), (300, 100)]);
            let (_, polygon) = feature(
                z,
                GeometryKind::Polygon,
                &[
                    (100, 100),
                    (200, 101),
                    (300, 100),
                    (300, 300),
                    (100, 300),
                    (100, 100),
                ],
            );
            let polygons = index(&[&polygon]);
            let line_layer = encode_layer(tile, "line".into(), vec![&line], &polygons).unwrap();
            let polygon_layer =
                encode_layer(tile, "polygon".into(), vec![&polygon], &polygons).unwrap();
            assert_eq!(
                (line_layer.features[0].geometry[3] >> 3) + 1,
                expected_line,
                "z{z}"
            );
            assert_eq!(
                (polygon_layer.features[0].geometry[3] >> 3) + 1,
                expected_polygon,
                "z{z}"
            );
        }
    }

    #[test]
    fn adjoining_polygons_keep_all_shared_vertices_even_with_different_spacing() {
        let (tile, a) = feature(
            13,
            GeometryKind::Polygon,
            &[
                (100, 100),
                (200, 101),
                (300, 100),
                (300, 300),
                (100, 300),
                (100, 100),
            ],
        );
        let (_, b) = feature(
            13,
            GeometryKind::Polygon,
            &[(100, 100), (300, 100), (300, 0), (100, 0), (100, 100)],
        );
        let polygons = index(&[&a, &b]);
        assert!(!polygons.permits(&a));
        assert!(!polygons.permits(&b));
        let layer = encode_layer(tile, "a".into(), vec![&a], &polygons).unwrap();
        assert_eq!((layer.features[0].geometry[3] >> 3) + 1, 5);
        assert!(!PolygonIndex::default().permits(&a));
        assert!(!polygons.permits(&ProjectedFeature {
            points: vec![],
            ..a.clone()
        }));
        assert_eq!(bounds(&[]), None);
    }

    #[test]
    fn rings_keep_closure_orientation_and_degenerate_input() {
        let ring = [(0, 0), (100, 1), (200, 0), (200, 200), (0, 200), (0, 0)];
        assert_eq!(
            polygon(&ring, 4.0),
            vec![(0, 0), (200, 0), (200, 200), (0, 200)]
        );
        assert_eq!(polygon(&ring, 0.0), ring);
        let reversed = ring.into_iter().rev().collect::<Vec<_>>();
        assert!(signed_area(&polygon(&reversed, 4.0)) < 0.0);
        let invalid = [(0, 0), (100, 100), (0, 100), (100, 0), (0, 0)];
        assert_eq!(polygon(&invalid, 4.0), invalid);
        let tiny = [(0, 0), (1, 0), (0, 1), (0, 0)];
        assert_eq!(polygon(&tiny, 4.0).len(), 3);
        assert_eq!(polygon(&[(0, 0), (1, 1)], 4.0), vec![(0, 0), (1, 1)]);
        let large = [
            (100_000, 100_000),
            (100_100, 100_001),
            (100_200, 100_000),
            (100_200, 100_200),
            (100_000, 100_200),
            (100_000, 100_000),
        ];
        assert_eq!(polygon(&large, 4.0).len(), 4);
        assert_eq!(signed_area(&large), 39_900.0);
    }
}
