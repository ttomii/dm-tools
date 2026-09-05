use std::process::Command;

#[test]
fn invokes_the_cli_entrypoint_for_an_input_error() {
    let input = format!(
        "/tmp/dm-converter-coverage-missing-{}.dm",
        std::process::id()
    );
    let output = format!(
        "/tmp/dm-converter-coverage-output-{}.gpkg",
        std::process::id()
    );
    let result = Command::new(env!("CARGO_BIN_EXE_dm-converter"))
        .args(["convert", &input, &output])
        .output()
        .expect("run dm-converter binary");

    assert_eq!(result.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&result.stderr).contains("input error"));
}
