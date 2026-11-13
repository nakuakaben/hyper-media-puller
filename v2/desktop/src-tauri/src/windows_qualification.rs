//! Windows CI only. Calls DevTools through the embedded controller, without a listening port.
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::WebviewWindow;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows_core::PCWSTR;

#[derive(Deserialize)]
struct Request {
    id: u64,
    method: String,
    params: Value,
}

fn respond(root: &Path, id: u64, value: Value) {
    let temp = root.join(format!("response-{id}.tmp"));
    if fs::write(&temp, value.to_string()).is_ok() {
        let _ = fs::rename(temp, root.join(format!("response-{id}.json")));
    }
}

pub fn fixture_root() -> Option<PathBuf> {
    if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true") {
        return None;
    }
    fs::canonicalize(std::env::var_os("HMP_WINDOWS_QUALIFICATION")?).ok()
}

pub fn starting_directory() -> Option<PathBuf> {
    let root = fixture_root()?;
    let requested = PathBuf::from(std::env::var_os("HMP_WINDOWS_QUALIFICATION_DESTINATION")?);
    let folder = fs::canonicalize(&requested).ok()?;
    (requested.is_absolute() && folder.starts_with(root) && folder.is_dir()).then_some(requested)
}

pub fn start(window: WebviewWindow) {
    let root = std::env::var_os("HMP_WINDOWS_QUALIFICATION").map(PathBuf::from);
    let Some(root) = root.filter(|path| path.is_absolute() && path.is_dir()) else {
        return;
    };
    if std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true") {
        return;
    }
    std::thread::spawn(move || {
        let input = root.join("request.json");
        loop {
            if let Ok(contents) = fs::read_to_string(&input) {
                let _ = fs::remove_file(&input);
                if let Ok(request) = serde_json::from_str::<Request>(&contents) {
                    let id = request.id;
                    let target = root.clone();
                    if let Err(error) = window.with_webview(move |webview| {
                        let output = target.clone();
                        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                            move |status, payload| {
                                let result = match status {
                                    Ok(()) => serde_json::from_str::<Value>(&payload)
                                        .map(|value| json!({"result": value}))
                                        .unwrap_or_else(
                                            |error| json!({"error": error.to_string()}),
                                        ),
                                    Err(error) => json!({"error": format!("{error}: {payload}")}),
                                };
                                respond(&output, id, result);
                                Ok(())
                            },
                        ));
                        let method: Vec<u16> = request.method.encode_utf16().chain([0]).collect();
                        let params: Vec<u16> = request
                            .params
                            .to_string()
                            .encode_utf16()
                            .chain([0])
                            .collect();
                        // The controller is provided on its UI thread. The bindings borrow the
                        // terminated strings only for the duration of the COM call.
                        let result = unsafe {
                            webview.controller().CoreWebView2().and_then(|view| {
                                view.CallDevToolsProtocolMethod(
                                    PCWSTR(method.as_ptr()),
                                    PCWSTR(params.as_ptr()),
                                    &handler,
                                )
                            })
                        };
                        if let Err(error) = result {
                            respond(&target, id, json!({"error": error.to_string()}));
                        }
                    }) {
                        respond(&root, id, json!({"error": error.to_string()}));
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    });
}
