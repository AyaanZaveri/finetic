#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Available(Option<String>),
    Downloading(Option<String>),
    Ready(Option<String>),
    Current,
    Error,
    Finished,
    Install,
    Relaunch,
}

// Sparkle reports these normal outcomes through its error delegate too.
// Values are pinned to Sparkle 2.10.1's SUErrors.h.
pub fn error_event(domain: &str, code: isize) -> Event {
    match (domain, code) {
        ("SUSparkleErrorDomain", 1001) => Event::Current,
        ("SUSparkleErrorDomain", 4007) => Event::Finished,
        _ => Event::Error,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_outcomes_are_not_failures() {
        assert_eq!(error_event("SUSparkleErrorDomain", 1001), Event::Current);
        assert_eq!(error_event("SUSparkleErrorDomain", 4007), Event::Finished);
    }
    #[test]
    fn network_and_other_domains_remain_errors() {
        assert_eq!(error_event("SUSparkleErrorDomain", 2001), Event::Error);
        assert_eq!(error_event("NSURLErrorDomain", 1001), Event::Error);
    }
}

// Keep normal quit and Sparkle's ready-to-relaunch event alive after resource cleanup.
pub fn install_should_exit(event: Option<Event>, quit: bool) -> bool {
    quit || matches!(event, Some(Event::Relaunch | Event::Error))
}

#[cfg(test)]
mod install_tests {
    use super::*;
    #[test]
    fn handoff_waits_for_installer_but_keeps_quit_live() {
        assert!(!install_should_exit(None, false));
        assert!(!install_should_exit(Some(Event::Install), false));
        assert!(!install_should_exit(Some(Event::Finished), false));
        assert!(install_should_exit(Some(Event::Relaunch), false));
        assert!(install_should_exit(None, true));
        assert!(install_should_exit(Some(Event::Error), false));
    }
}
