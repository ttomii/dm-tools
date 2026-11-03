// © TOMII, Tatsuru

use clap::ValueEnum;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum InputDatum {
    Jgd2000,
    Jgd2011,
    Jgd2024,
}

impl InputDatum {
    pub fn epsg(self, zone: u8) -> i64 {
        let base = match self {
            Self::Jgd2000 => 2442,
            Self::Jgd2011 | Self::Jgd2024 => 6668,
        };
        base + i64::from(zone)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Jgd2000 => "JGD2000",
            Self::Jgd2011 => "JGD2011",
            Self::Jgd2024 => "JGD2024",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_all_zones_to_epsg() {
        for zone in 1..=19 {
            assert_eq!(InputDatum::Jgd2000.epsg(zone), 2442 + i64::from(zone));
            assert_eq!(InputDatum::Jgd2011.epsg(zone), 6668 + i64::from(zone));
            assert_eq!(InputDatum::Jgd2024.epsg(zone), 6668 + i64::from(zone));
        }
    }
}
