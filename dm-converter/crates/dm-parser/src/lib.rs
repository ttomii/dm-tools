// © TOMII, Tatsuru

use encoding_rs::{EUC_JP, Encoding, SHIFT_JIS};
use std::collections::VecDeque;
use std::io::{self, BufRead};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum GeometryKind {
    Polygon,
    Line,
    Point,
    Text,
}

impl GeometryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Polygon => "polygon",
            Self::Line => "line",
            Self::Point => "point",
            Self::Text => "text",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coordinate {
    pub x: f64,
    pub y: f64,
    pub z: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Geometry {
    Point(Coordinate),
    LineString(Vec<Coordinate>),
    Polygon(Vec<Coordinate>),
    Circle {
        center: Coordinate,
        radius: f64,
        source: [Coordinate; 3],
    },
    Arc {
        center: Coordinate,
        radius: f64,
        start_angle: f64,
        end_angle: f64,
        clockwise: bool,
        source: [Coordinate; 3],
    },
    TextPoint(Coordinate),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Attributes {
    pub dmfigtype: Option<i64>,
    pub dmmove: Option<i64>,
    pub dmskip: Option<i64>,
    pub dmattr: Option<i64>,
    pub dmprec: Option<i64>,
    pub dmyymm: Option<i64>,
    pub angle: Option<f64>,
    pub size: Option<f64>,
    pub char_spacing: Option<f64>,
    pub line_no: Option<i64>,
    pub vertical: Option<i64>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Feature {
    pub source_file: String,
    pub source_line: u64,
    pub plane_rectangular_zone: Option<u8>,
    pub map_level: Option<i64>,
    pub dmcode: i64,
    pub geometry_kind: GeometryKind,
    pub geometry: Geometry,
    pub attributes: Attributes,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseWarning {
    pub source_file: String,
    pub source_line: u64,
    pub message: String,
    pub skipped: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ParseEvent {
    Feature(Box<Feature>),
    Metadata(DmMetadata),
    Warning(ParseWarning),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DmMetadata {
    pub plane_rectangular_zone: Option<u8>,
}

#[derive(Debug, Clone)]
pub struct ParserConfig {
    pub encoding: &'static Encoding,
    /// ファイル内ヘッダから平面直角座標系番号を特定できないときに使う番号
    pub plane_rectangular_zone_override: Option<u8>,
}

impl Default for ParserConfig {
    fn default() -> Self {
        Self {
            encoding: SHIFT_JIS,
            plane_rectangular_zone_override: None,
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParseSummary {
    pub features: u64,
    pub warnings: u64,
    pub skipped: u64,
}

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("{source_file}:{line}: I/O error: {source}")]
    Io {
        source_file: String,
        line: u64,
        #[source]
        source: io::Error,
    },
}

#[derive(Debug, Clone, Copy)]
struct Mesh {
    origin_x: f64,
    origin_y: f64,
    unit: f64,
}

pub struct DmParser<R: BufRead> {
    reader: R,
    source_file: String,
    config: ParserConfig,
    line: u64,
    plane_rectangular_zone: Option<u8>,
    map_level: Option<i64>,
    mesh: Option<Mesh>,
    pending: VecDeque<ParseEvent>,
    zone_warning_emitted: bool,
}

impl<R: BufRead> DmParser<R> {
    pub fn new(reader: R, source_file: impl Into<String>, config: ParserConfig) -> Self {
        Self {
            reader,
            source_file: source_file.into(),
            config,
            line: 0,
            plane_rectangular_zone: None,
            map_level: None,
            mesh: None,
            pending: VecDeque::new(),
            zone_warning_emitted: false,
        }
    }

    fn read_line(&mut self) -> Result<Option<Vec<u8>>, ParseError> {
        let mut line = Vec::with_capacity(86);
        match self.reader.read_until(b'\n', &mut line) {
            Ok(0) => Ok(None),
            Ok(_) => {
                self.line += 1;
                while matches!(line.last(), Some(b'\n' | b'\r')) {
                    line.pop();
                }
                Ok(Some(line))
            }
            Err(source) => Err(ParseError::Io {
                source_file: self.source_file.clone(),
                line: self.line + 1,
                source,
            }),
        }
    }

    fn warning(&mut self, source_line: u64, message: impl Into<String>, skipped: bool) {
        self.pending.push_back(ParseEvent::Warning(ParseWarning {
            source_file: self.source_file.clone(),
            source_line,
            message: message.into(),
            skipped,
        }));
    }

    fn skip_lines(&mut self, count: usize, source_line: u64) -> Result<Vec<Vec<u8>>, ParseError> {
        let mut rows = Vec::with_capacity(count);
        for _ in 0..count {
            match self.read_line()? {
                Some(row) => rows.push(row),
                None => {
                    self.warning(source_line, "unexpected end of file", true);
                    break;
                }
            }
        }
        Ok(rows)
    }

    fn effective_zone(&self) -> Option<u8> {
        self.plane_rectangular_zone
            .or(self.config.plane_rectangular_zone_override)
    }

    fn parse_mesh(&mut self, first: Vec<u8>, source_line: u64) -> Result<(), ParseError> {
        if self.plane_rectangular_zone.is_none() {
            self.plane_rectangular_zone = plane_rectangular_zone_from_record(&first);
        }
        if self.effective_zone().is_none() && !self.zone_warning_emitted {
            self.zone_warning_emitted = true;
            self.warning(source_line, "平面直角座標系番号を特定できません", false);
        }
        let map_level = number_i64(&first, 30, 5).unwrap_or(2500);
        self.map_level = Some(map_level);
        let modifications = number_i64(&first, 65, 2).unwrap_or(0).max(0) as usize;
        let Some(second) = self.read_line()? else {
            self.warning(source_line, "incomplete mesh record", true);
            return Ok(());
        };
        let _third = self.read_line()?;
        let coordinate_unit = match number_i64(&second, 44, 3).unwrap_or(999) {
            1 => 0.001,
            10 => 0.01,
            _ => 1.0,
        };
        let fraction_unit = if map_level < 2500 { 0.001 } else { 0.01 };
        let mut final_e = None;
        for _ in 0..=modifications {
            let Some(d) = self.read_line()? else {
                self.warning(source_line, "incomplete mesh revision record", true);
                return Ok(());
            };
            let course_count = number_i64(&d, 9, 1).unwrap_or(0).max(0) as usize;
            final_e = self.read_line()?;
            self.skip_lines(course_count, source_line)?;
        }
        let Some(e) = final_e else {
            self.warning(source_line, "mesh origin record is missing", true);
            return Ok(());
        };
        let northing_fraction = number_f64(&e, 40, 4).unwrap_or(0.0) * fraction_unit;
        let easting_fraction = number_f64(&e, 44, 4).unwrap_or(0.0) * fraction_unit;
        self.mesh = Some(Mesh {
            origin_x: number_f64(&second, 7, 7).unwrap_or(0.0) + easting_fraction,
            origin_y: number_f64(&second, 0, 7).unwrap_or(0.0) + northing_fraction,
            unit: coordinate_unit,
        });
        Ok(())
    }

    fn parse_element(
        &mut self,
        header: Vec<u8>,
        source_line: u64,
    ) -> Result<Option<Feature>, ParseError> {
        let record_type = header.get(1).copied().unwrap_or_default();
        let record_count = number_i64(&header, 31, 4).unwrap_or(0).max(0) as usize;
        let rows = self.skip_lines(record_count, source_line)?;
        let Some(mesh) = self.mesh else {
            self.warning(source_line, "element encountered before mesh record", true);
            return Ok(None);
        };
        let result = self.build_feature(record_type, &header, &rows, mesh, source_line);
        match result {
            Ok(feature) => Ok(Some(feature)),
            Err(message) => {
                self.warning(source_line, message, true);
                Ok(None)
            }
        }
    }

    fn build_feature(
        &self,
        record_type: u8,
        header: &[u8],
        rows: &[Vec<u8>],
        mesh: Mesh,
        source_line: u64,
    ) -> Result<Feature, String> {
        let dmcode = required_i64(header, 2, 4, "DMCODE")?;
        let following = required_i64(header, 20, 1, "following record type")?;
        let data_count = required_i64(header, 27, 4, "data count")?.max(0) as usize;
        let mut attributes = Attributes {
            dmfigtype: number_i64(header, 18, 2),
            dmprec: number_i64(header, 21, 2),
            dmmove: number_i64(header, 24, 2),
            dmskip: number_i64(header, 26, 1),
            dmattr: number_i64(header, 49, 7),
            dmyymm: number_i64(header, 65, 4),
            ..Attributes::default()
        };
        let direct_point = || -> Result<Coordinate, String> {
            Ok(Coordinate {
                x: mesh.origin_x + required_f64(header, 42, 7, "X")? * mesh.unit,
                y: mesh.origin_y + required_f64(header, 35, 7, "Y")? * mesh.unit,
                z: None,
            })
        };
        let (geometry_kind, geometry) = match record_type {
            b'1' => {
                let mut points = coordinates(rows, following, data_count, mesh)?;
                close_ring(&mut points);
                (GeometryKind::Polygon, Geometry::Polygon(points))
            }
            b'2' => (
                GeometryKind::Line,
                Geometry::LineString(coordinates(rows, following, data_count, mesh)?),
            ),
            b'3' | b'4' => {
                let points = coordinates(rows, following, data_count, mesh)?;
                if points.len() != 3 {
                    return Err(format!(
                        "circle/arc requires 3 points, got {}",
                        points.len()
                    ));
                }
                let source = [points[0], points[1], points[2]];
                let (center, radius) = circle_from_three(source)?;
                if record_type == b'3' {
                    (
                        GeometryKind::Line,
                        Geometry::Circle {
                            center,
                            radius,
                            source,
                        },
                    )
                } else {
                    let a1 = angle(center, source[0]);
                    let a2 = normalize_angle(angle(center, source[1]) - a1);
                    let a3 = normalize_angle(angle(center, source[2]) - a1);
                    let clockwise = a3 <= a2;
                    (
                        GeometryKind::Line,
                        Geometry::Arc {
                            center,
                            radius,
                            start_angle: a1,
                            end_angle: angle(center, source[2]),
                            clockwise,
                            source,
                        },
                    )
                }
            }
            b'5' => {
                if data_count != 0 {
                    return Err("point collections are not supported".to_string());
                }
                (GeometryKind::Point, Geometry::Point(direct_point()?))
            }
            b'6' => {
                let points = coordinates(rows, following, data_count, mesh)?;
                if points.len() < 2 {
                    return Err("direction requires two coordinates".to_string());
                }
                attributes.angle = Some(
                    (points[1].y - points[0].y)
                        .atan2(points[1].x - points[0].x)
                        .to_degrees(),
                );
                (GeometryKind::Point, Geometry::Point(points[0]))
            }
            b'7' => {
                let point = direct_point()?;
                let row = rows
                    .first()
                    .ok_or_else(|| "annotation row is missing".to_string())?;
                attributes.vertical = number_i64(row, 0, 1);
                attributes.angle = number_f64(row, 1, 7);
                attributes.size = number_f64(row, 8, 5);
                attributes.char_spacing = number_f64(row, 13, 5);
                attributes.line_no = number_i64(row, 18, 2);
                let annotation_type = number_i64(header, 23, 1).unwrap_or(2);
                let bytes_needed = if annotation_type == 1 {
                    data_count * 2
                } else {
                    data_count
                };
                let mut text_bytes = Vec::with_capacity(bytes_needed);
                for row in rows {
                    if row.len() > 20 {
                        text_bytes.extend_from_slice(&row[20..row.len().min(84)]);
                    }
                    if text_bytes.len() >= bytes_needed {
                        break;
                    }
                }
                text_bytes.truncate(bytes_needed);
                let text =
                    decode_annotation_text(self.config.encoding, &text_bytes, annotation_type);
                attributes.text = Some(text.into_owned());
                (GeometryKind::Text, Geometry::TextPoint(point))
            }
            b'8' => return Err("attribute detail records are not supported".to_string()),
            _ => return Err(format!("unsupported element type E{}", record_type as char)),
        };
        Ok(Feature {
            source_file: self.source_file.clone(),
            source_line,
            plane_rectangular_zone: self.effective_zone(),
            map_level: self.map_level,
            dmcode,
            geometry_kind,
            geometry,
            attributes,
            warnings: Vec::new(),
        })
    }
}

impl<R: BufRead> Iterator for DmParser<R> {
    type Item = Result<ParseEvent, ParseError>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(event) = self.pending.pop_front() {
            return Some(Ok(event));
        }
        loop {
            let line = match self.read_line() {
                Ok(Some(line)) => line,
                Ok(None) => return self.pending.pop_front().map(Ok),
                Err(error) => return Some(Err(error)),
            };
            let source_line = self.line;
            let record = line.get(0..2).unwrap_or_default();
            let result = match record {
                b"M " => self.parse_mesh(line, source_line).map(|_| None),
                b"I " => {
                    let plane_rectangular_zone = plane_rectangular_zone_from_record(&line);
                    self.plane_rectangular_zone = plane_rectangular_zone;
                    let count = number_i64(&line, 37, 2).unwrap_or(0).max(0) as usize;
                    self.skip_lines(count, source_line).map(|_| {
                        Some(ParseEvent::Metadata(DmMetadata {
                            plane_rectangular_zone,
                        }))
                    })
                }
                b"G " => {
                    let count = number_i64(&line, 26, 4).unwrap_or(0).max(0) as usize;
                    let result = self.skip_lines(count, source_line).map(|_| None);
                    self.warning(source_line, "grid record is not supported", true);
                    result
                }
                b"T " => {
                    let count = number_i64(&line, 26, 6).unwrap_or(0).max(0) as usize;
                    let result = self.skip_lines(count, source_line).map(|_| None);
                    self.warning(source_line, "TIN record is not supported", true);
                    result
                }
                [b'E', b'0'..=b'9'] => self
                    .parse_element(line, source_line)
                    .map(|feature| feature.map(|feature| ParseEvent::Feature(Box::new(feature)))),
                _ => Ok(None),
            };
            match result {
                Ok(Some(event)) => return Some(Ok(event)),
                Ok(None) => {
                    if let Some(event) = self.pending.pop_front() {
                        return Some(Ok(event));
                    }
                }
                Err(error) => return Some(Err(error)),
            }
        }
    }
}

pub fn summarize<I>(events: I) -> Result<ParseSummary, ParseError>
where
    I: IntoIterator<Item = Result<ParseEvent, ParseError>>,
{
    let mut summary = ParseSummary::default();
    for event in events {
        match event? {
            ParseEvent::Feature(_) => summary.features += 1,
            ParseEvent::Metadata(_) => {}
            ParseEvent::Warning(warning) => {
                summary.warnings += 1;
                summary.skipped += u64::from(warning.skipped);
            }
        }
    }
    Ok(summary)
}

fn field(bytes: &[u8], start: usize, count: usize) -> Option<&[u8]> {
    bytes.get(start..start.checked_add(count)?)
}

fn number_i64(bytes: &[u8], start: usize, count: usize) -> Option<i64> {
    std::str::from_utf8(field(bytes, start, count)?)
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn number_f64(bytes: &[u8], start: usize, count: usize) -> Option<f64> {
    std::str::from_utf8(field(bytes, start, count)?)
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn decode_annotation_text<'a>(
    encoding: &'static Encoding,
    bytes: &'a [u8],
    annotation_type: i64,
) -> std::borrow::Cow<'a, str> {
    if annotation_type == 1
        && let Some(text) = decode_jis_x0208_gl_annotation(bytes)
    {
        return text;
    }
    let (text, _, _) = encoding.decode(bytes);
    text
}

fn decode_jis_x0208_gl_annotation(bytes: &[u8]) -> Option<std::borrow::Cow<'static, str>> {
    if bytes.len() % 2 != 0
        || !bytes
            .chunks_exact(2)
            .all(|pair| (0x21..=0x7e).contains(&pair[0]) && (0x21..=0x7e).contains(&pair[1]))
    {
        return None;
    }

    let euc_jp_bytes = bytes.iter().map(|byte| byte | 0x80).collect::<Vec<_>>();
    let (text, _, had_errors) = EUC_JP.decode(&euc_jp_bytes);
    if had_errors || japanese_char_count(&text) == 0 {
        return None;
    }
    Some(std::borrow::Cow::Owned(text.into_owned()))
}

fn japanese_char_count(text: &str) -> usize {
    text.chars()
        .filter(|char| {
            matches!(
                *char as u32,
                0x3040..=0x30ff | 0x3400..=0x9fff | 0xf900..=0xfaff
            )
        })
        .count()
}

fn required_i64(bytes: &[u8], start: usize, count: usize, name: &str) -> Result<i64, String> {
    number_i64(bytes, start, count).ok_or_else(|| format!("invalid {name}"))
}

fn required_f64(bytes: &[u8], start: usize, count: usize, name: &str) -> Result<f64, String> {
    number_f64(bytes, start, count).ok_or_else(|| format!("invalid {name}"))
}

fn coordinates(
    rows: &[Vec<u8>],
    following: i64,
    data_count: usize,
    mesh: Mesh,
) -> Result<Vec<Coordinate>, String> {
    let dimensions = match following {
        0 | 2 => 2,
        3 | 6 => 3,
        value => return Err(format!("unsupported coordinate type {value}")),
    };
    let per_row = if dimensions == 2 { 6 } else { 4 };
    let mut points = Vec::with_capacity(data_count);
    for index in 0..data_count {
        let row = rows
            .get(index / per_row)
            .ok_or_else(|| "coordinate record is missing".to_string())?;
        let offset = (index % per_row) * dimensions * 7;
        let y = required_f64(row, offset, 7, "Y coordinate")?;
        let x = required_f64(row, offset + 7, 7, "X coordinate")?;
        let z = if dimensions == 3 {
            Some(required_f64(row, offset + 14, 7, "Z coordinate")? * mesh.unit)
        } else {
            None
        };
        points.push(Coordinate {
            x: mesh.origin_x + x * mesh.unit,
            y: mesh.origin_y + y * mesh.unit,
            z,
        });
    }
    if points.is_empty() {
        return Err("element contains no coordinates".to_string());
    }
    Ok(points)
}

fn close_ring(points: &mut Vec<Coordinate>) {
    if points.first() != points.last()
        && let Some(first) = points.first().copied()
    {
        points.push(first);
    }
}

fn circle_from_three(points: [Coordinate; 3]) -> Result<(Coordinate, f64), String> {
    let [a, b, c] = points;
    let d = 2.0 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if d.abs() < f64::EPSILON {
        return Err("circle points are collinear".to_string());
    }
    let a2 = a.x * a.x + a.y * a.y;
    let b2 = b.x * b.x + b.y * b.y;
    let c2 = c.x * c.x + c.y * c.y;
    let center = Coordinate {
        x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
        y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
        z: None,
    };
    let radius = ((center.x - a.x).powi(2) + (center.y - a.y).powi(2)).sqrt();
    Ok((center, radius))
}

fn angle(center: Coordinate, point: Coordinate) -> f64 {
    (point.y - center.y).atan2(point.x - center.x).to_degrees()
}

fn normalize_angle(mut angle: f64) -> f64 {
    while angle < 0.0 {
        angle += 360.0;
    }
    while angle >= 360.0 {
        angle -= 360.0;
    }
    angle
}

fn plane_rectangular_zone_from_record(record: &[u8]) -> Option<u8> {
    number_i64(record, 2, 2)
        .and_then(|zone| u8::try_from(zone).ok())
        .filter(|zone| (1..=19).contains(zone))
}

pub fn display_source(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn fixed_line(fields: &[(usize, &str)]) -> Vec<u8> {
        let mut line = vec![b' '; 84];
        for (start, value) in fields {
            line[*start..*start + value.len()].copy_from_slice(value.as_bytes());
        }
        line.extend_from_slice(b"\r\n");
        line
    }

    fn fixed_line_bytes(fields: &[(usize, &[u8])]) -> Vec<u8> {
        let mut line = vec![b' '; 84];
        for (start, value) in fields {
            line[*start..*start + value.len()].copy_from_slice(value);
        }
        line.extend_from_slice(b"\r\n");
        line
    }

    fn sample(element: Vec<u8>, following: Vec<Vec<u8>>) -> Vec<u8> {
        sample_with_origin_fraction(element, following, "0000", "0000")
    }

    fn sample_with_origin_fraction(
        element: Vec<u8>,
        following: Vec<Vec<u8>>,
        northing_fraction: &str,
        easting_fraction: &str,
    ) -> Vec<u8> {
        let mut input = Vec::new();
        input.extend(fixed_line(&[
            (0, "M "),
            (2, "08DF244"),
            (30, " 2500"),
            (65, " 0"),
        ]));
        input.extend(fixed_line(&[(0, " 100000"), (7, " 200000"), (44, "999")]));
        input.extend(fixed_line(&[]));
        input.extend(fixed_line(&[(9, "0")]));
        input.extend(fixed_line(&[
            (40, northing_fraction),
            (44, easting_fraction),
        ]));
        input.extend(element);
        for row in following {
            input.extend(row);
        }
        input
    }

    fn sample_without_zone(element: Vec<u8>, following: Vec<Vec<u8>>) -> Vec<u8> {
        let mut input = Vec::new();
        input.extend(fixed_line(&[
            (0, "M "),
            (2, "XXDF244"),
            (30, " 2500"),
            (65, " 0"),
        ]));
        input.extend(fixed_line(&[(0, " 100000"), (7, " 200000"), (44, "999")]));
        input.extend(fixed_line(&[]));
        input.extend(fixed_line(&[(9, "0")]));
        input.extend(fixed_line(&[(40, "0000"), (44, "0000")]));
        input.extend(element);
        for row in following {
            input.extend(row);
        }
        input
    }

    fn line_element() -> (Vec<u8>, Vec<u8>) {
        let header = fixed_line(&[
            (0, "E2"),
            (2, "2100"),
            (20, "2"),
            (27, "0002"),
            (31, "0001"),
        ]);
        let coords = fixed_line(&[
            (0, "0000010"),
            (7, "0000020"),
            (14, "0000030"),
            (21, "0000040"),
        ]);
        (header, coords)
    }

    #[test]
    fn applies_zone_override_when_header_lacks_zone() {
        let (header, coords) = line_element();
        let config = ParserConfig {
            encoding: SHIFT_JIS,
            plane_rectangular_zone_override: Some(6),
        };
        let parser = DmParser::new(
            Cursor::new(sample_without_zone(header, vec![coords])),
            "06test.dm",
            config,
        );
        let feature = parser
            .filter_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) | ParseEvent::Warning(_) => None,
            })
            .next()
            .unwrap();
        assert_eq!(feature.plane_rectangular_zone, Some(6));
    }

    #[test]
    fn override_does_not_replace_zone_parsed_from_header() {
        let (header, coords) = line_element();
        let config = ParserConfig {
            encoding: SHIFT_JIS,
            plane_rectangular_zone_override: Some(6),
        };
        let parser = DmParser::new(Cursor::new(sample(header, vec![coords])), "test.dm", config);
        let feature = parser
            .filter_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) | ParseEvent::Warning(_) => None,
            })
            .next()
            .unwrap();
        assert_eq!(feature.plane_rectangular_zone, Some(8));
    }

    #[test]
    fn warns_once_when_zone_cannot_be_determined() {
        let (header, coords) = line_element();
        let events: Vec<_> = DmParser::new(
            Cursor::new(sample_without_zone(header, vec![coords])),
            "06test.dm",
            ParserConfig::default(),
        )
        .collect::<Result<_, _>>()
        .unwrap();
        let warnings = events
            .iter()
            .filter(|event| matches!(event, ParseEvent::Warning(_)))
            .count();
        assert_eq!(warnings, 1);
        let feature = events
            .iter()
            .find_map(|event| match event {
                ParseEvent::Feature(feature) => Some(feature),
                _ => None,
            })
            .unwrap();
        assert_eq!(feature.plane_rectangular_zone, None);
    }

    #[test]
    fn parses_line_coordinates_and_attributes() {
        let header = fixed_line(&[
            (0, "E2"),
            (2, "2100"),
            (18, "04"),
            (20, "2"),
            (21, "30"),
            (24, "01"),
            (26, "0"),
            (27, "0002"),
            (31, "0001"),
            (49, "     12"),
            (65, "1312"),
        ]);
        let coords = fixed_line(&[
            (0, "0000010"),
            (7, "0000020"),
            (14, "0000030"),
            (21, "0000040"),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample(header, vec![coords])),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) => None,
                ParseEvent::Warning(_) => None,
            })
            .unwrap();
        assert_eq!(feature.dmcode, 2100);
        assert_eq!(feature.plane_rectangular_zone, Some(8));
        assert_eq!(feature.map_level, Some(2500));
        assert_eq!(feature.attributes.dmfigtype, Some(4));
        assert_eq!(feature.attributes.dmattr, Some(12));
        assert_eq!(
            feature.geometry,
            Geometry::LineString(vec![
                Coordinate {
                    x: 200020.0,
                    y: 100010.0,
                    z: None
                },
                Coordinate {
                    x: 200040.0,
                    y: 100030.0,
                    z: None
                },
            ])
        );
    }

    #[test]
    fn applies_mesh_origin_fraction_to_the_corresponding_axis() {
        let header = fixed_line(&[
            (0, "E2"),
            (2, "2100"),
            (20, "2"),
            (27, "0002"),
            (31, "0001"),
        ]);
        let coords = fixed_line(&[
            (0, "0000010"),
            (7, "0000020"),
            (14, "0000030"),
            (21, "0000040"),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample_with_origin_fraction(
                header,
                vec![coords],
                "0012",
                "0034",
            )),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) | ParseEvent::Warning(_) => None,
            })
            .unwrap();

        let Geometry::LineString(points) = feature.geometry else {
            panic!("expected line string");
        };
        assert!((points[0].x - 200_020.34).abs() < 1.0e-9);
        assert!((points[0].y - 100_010.12).abs() < 1.0e-9);
    }

    #[test]
    fn unsupported_records_become_warnings() {
        let input = fixed_line(&[(0, "G "), (26, "0000")]);
        let events: Vec<_> = DmParser::new(Cursor::new(input), "test.dm", ParserConfig::default())
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(matches!(events.as_slice(), [ParseEvent::Warning(_)]));
    }

    #[test]
    fn parses_plane_rectangular_zone_from_index_record() {
        let input = fixed_line(&[(0, "I "), (2, "08"), (37, "00")]);
        let events: Vec<_> = DmParser::new(Cursor::new(input), "test.dm", ParserConfig::default())
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            events,
            vec![ParseEvent::Metadata(DmMetadata {
                plane_rectangular_zone: Some(8)
            })]
        );
    }

    #[test]
    fn parses_plane_rectangular_zone_from_mesh_record_when_index_is_absent() {
        let header = fixed_line(&[
            (0, "E2"),
            (2, "2100"),
            (20, "2"),
            (27, "0002"),
            (31, "0001"),
        ]);
        let coords = fixed_line(&[
            (0, "0000010"),
            (7, "0000020"),
            (14, "0000030"),
            (21, "0000040"),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample(header, vec![coords])),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) | ParseEvent::Warning(_) => None,
            })
            .unwrap();

        assert_eq!(feature.plane_rectangular_zone, Some(8));
    }

    #[test]
    fn parses_circle_from_three_points() {
        let header = fixed_line(&[
            (0, "E3"),
            (2, "4200"),
            (20, "2"),
            (27, "0003"),
            (31, "0001"),
        ]);
        let coords = fixed_line(&[
            (0, "0000010"),
            (7, "0000000"),
            (14, "0000000"),
            (21, "0000010"),
            (28, "-000010"),
            (35, "0000000"),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample(header, vec![coords])),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) => None,
                ParseEvent::Warning(_) => None,
            })
            .unwrap();
        match feature.geometry {
            Geometry::Circle { radius, .. } => assert!((radius - 10.0).abs() < 1e-9),
            geometry => panic!("unexpected geometry: {geometry:?}"),
        }
    }

    #[test]
    fn parses_direction_angle() {
        let header = fixed_line(&[
            (0, "E6"),
            (2, "3500"),
            (20, "2"),
            (27, "0002"),
            (31, "0001"),
        ]);
        let coords = fixed_line(&[
            (0, "0000000"),
            (7, "0000000"),
            (14, "0000010"),
            (21, "0000000"),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample(header, vec![coords])),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) => None,
                ParseEvent::Warning(_) => None,
            })
            .unwrap();
        assert_eq!(feature.attributes.angle, Some(90.0));
        assert!(matches!(feature.geometry, Geometry::Point(_)));
    }

    #[test]
    fn parses_annotation_attributes_and_text() {
        let header = fixed_line(&[
            (0, "E7"),
            (2, "8100"),
            (20, "4"),
            (23, "2"),
            (27, "0004"),
            (31, "0001"),
            (35, "0000010"),
            (42, "0000020"),
        ]);
        let row = fixed_line(&[
            (0, "1"),
            (1, "0000090"),
            (8, "00120"),
            (13, "00012"),
            (18, "03"),
            (20, "TEST"),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample(header, vec![row])),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) => None,
                ParseEvent::Warning(_) => None,
            })
            .unwrap();
        assert_eq!(feature.attributes.vertical, Some(1));
        assert_eq!(feature.attributes.angle, Some(90.0));
        assert_eq!(feature.attributes.size, Some(120.0));
        assert_eq!(feature.attributes.char_spacing, Some(12.0));
        assert_eq!(feature.attributes.line_no, Some(3));
        assert_eq!(feature.attributes.text.as_deref(), Some("TEST"));
    }

    #[test]
    fn decodes_annotation_text_stored_as_jis_x0208_gl() {
        let header = fixed_line(&[
            (0, "E7"),
            (2, "8110"),
            (20, "2"),
            (23, "1"),
            (27, "0003"),
            (31, "0001"),
            (35, "0000010"),
            (42, "0000020"),
        ]);
        let row = fixed_line_bytes(&[
            (0, b"0"),
            (1, b"0000000"),
            (8, b"00050"),
            (13, b"00200"),
            (18, b"08"),
            (20, &[0x3f, 0x37, 0x33, 0x63, 0x3b, 0x54]),
        ]);
        let mut parser = DmParser::new(
            Cursor::new(sample(header, vec![row])),
            "test.dm",
            ParserConfig::default(),
        );
        let feature = parser
            .find_map(|event| match event.unwrap() {
                ParseEvent::Feature(feature) => Some(feature),
                ParseEvent::Metadata(_) | ParseEvent::Warning(_) => None,
            })
            .unwrap();
        assert_eq!(feature.attributes.text.as_deref(), Some("新潟市"));
    }
}
