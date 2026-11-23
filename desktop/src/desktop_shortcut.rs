use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

pub fn settings(open: impl Fn() + Send + Sync + 'static) -> Option<GlobalHotKeyManager> {
    let modifiers = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    let shortcut = HotKey::new(Some(modifiers), Code::Comma);
    let result = GlobalHotKeyManager::new().and_then(|manager| {
        manager.register(shortcut)?;
        Ok(manager)
    });
    match result {
        Ok(manager) => {
            GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
                if event.id == shortcut.id() && event.state == HotKeyState::Pressed {
                    open();
                }
            }));
            Some(manager)
        }
        Err(error) => {
            log::info!("System Settings shortcut unavailable: {error}");
            None
        }
    }
}
