use base64::{engine::general_purpose::STANDARD, Engine};
use xcap::Monitor;

fn primary_monitor() -> Result<Monitor, String> {
    Monitor::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| "No primary monitor found".to_string())
}

fn encode_png(raw: &[u8], width: u32, height: u32) -> Result<String, String> {
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = enc.write_header().map_err(|e| e.to_string())?;
        w.write_image_data(raw).map_err(|e| e.to_string())?;
    }
    Ok(STANDARD.encode(&buf))
}

#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    let img = primary_monitor()?.capture_image().map_err(|e| e.to_string())?;
    encode_png(img.as_raw(), img.width(), img.height())
}

#[tauri::command]
pub fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let img = primary_monitor()?.capture_image().map_err(|e| e.to_string())?;

    let fw = img.width();
    let fh = img.height();
    let raw = img.as_raw();

    // Clamp to monitor bounds
    let x = x.min(fw.saturating_sub(1));
    let y = y.min(fh.saturating_sub(1));
    let w = width.min(fw - x);
    let h = height.min(fh - y);

    let mut cropped = Vec::with_capacity((w * h * 4) as usize);
    for row in y..(y + h) {
        let start = (row * fw + x) as usize * 4;
        cropped.extend_from_slice(&raw[start..start + w as usize * 4]);
    }

    encode_png(&cropped, w, h)
}
