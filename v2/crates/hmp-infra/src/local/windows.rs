use super::{Dir, File, OpenOptions, expect_collision};
use cap_std::fs::OpenOptionsExt;
use std::{
    io::{self, Write},
    mem::{offset_of, size_of},
    os::windows::io::AsRawHandle,
};
use windows_sys::Win32::{
    Foundation::{GENERIC_READ, GENERIC_WRITE, HANDLE},
    Storage::FileSystem::{DELETE, FILE_RENAME_INFO, FileRenameInfo, SetFileInformationByHandle},
};

pub(super) fn enable_rename(options: &mut OpenOptions) {
    options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
}

#[repr(C)]
struct RenameInfo {
    flags: u32,
    root: HANDLE,
    length: u32,
    name: [u16; 256],
}

pub(super) fn publish(file: &File, target: &Dir, name: &str) -> io::Result<()> {
    let target = target.try_clone()?.into_std_file();
    let mut info = RenameInfo {
        flags: 0,
        root: target.as_raw_handle(),
        length: 0,
        name: [0; 256],
    };
    // Both callers supply a single ASCII leaf, with neither a prefix nor a stream name.
    assert!(name.is_ascii() && !name.contains(['\\', '/', ':']) && name.len() < info.name.len());
    for (unit, byte) in info.name.iter_mut().zip(name.bytes()) {
        *unit = u16::from(byte);
    }
    info.length = (name.len() * size_of::<u16>()) as u32;
    const _: () = assert!(offset_of!(RenameInfo, name) == offset_of!(FILE_RENAME_INFO, FileName));
    let size = (offset_of!(RenameInfo, name) + info.length as usize + size_of::<u16>())
        .max(size_of::<FILE_RENAME_INFO>());
    native_rename(file, &info, size as u32)
}

#[allow(unsafe_code)]
fn native_rename(file: &File, info: &RenameInfo, size: u32) -> io::Result<()> {
    // The source and destination handles and initialized FILE_RENAME_INFO
    // buffer remain live throughout the synchronous call. Flags are zero.
    let ok = unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileRenameInfo,
            std::ptr::from_ref(info).cast(),
            size,
        )
    };
    if ok == 0 {
        let error = io::Error::last_os_error();
        return Err(match error.raw_os_error() {
            Some(1 | 50) => io::ErrorKind::Unsupported.into(),
            _ => error,
        });
    }
    Ok(())
}

pub(super) fn probe(stage: &Dir, target: &Dir) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    enable_rename(&mut options);
    let marker = format!("hmp-probe-{}", hmp_domain::Uuid::new_v4());
    let result = (|| {
        let mut source = stage.open_with("probe", &options)?;
        source.write_all(b"source")?;
        let mut existing =
            target.open_with(&marker, OpenOptions::new().write(true).create_new(true))?;
        let collision = (|| -> io::Result<()> {
            existing.write_all(b"existing")?;
            drop(existing);
            expect_collision(publish(&source, target, &marker))?;
            if stage.read("probe")? != b"source" || target.read(&marker)? != b"existing" {
                return Err(io::ErrorKind::Unsupported.into());
            }
            Ok(())
        })();
        let cleanup = target.remove_file(&marker);
        collision?;
        cleanup?;
        publish(&source, target, &marker)?;
        let result = target.read(&marker);
        let cleanup = target.remove_file(&marker);
        if result? != b"source" {
            return Err(io::ErrorKind::Unsupported.into());
        }
        cleanup
    })();
    let _ = stage.remove_file("probe");
    result
}
