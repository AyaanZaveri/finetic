use super::*;

const SESSION: &str = "track-switch-probe";

fn position(mpv: &Mpv) -> f64 {
    mpv.get_property("time-pos", Kind::Double)
        .and_then(|value| value.as_f64())
        .unwrap_or_default()
}

fn observe(
    label: &str,
    mpv: &Mpv,
    player: &Player,
    inbox: &mpsc::Receiver<(Instant, Value)>,
    track: Option<(&str, TrackKind, i64)>,
) {
    while inbox.try_recv().is_ok() {}
    let initial_position = position(mpv);
    let started = Instant::now();
    let mut previous_position = initial_position;
    let mut last_progress = started;
    let mut max_clock_gap = Duration::ZERO;
    let mut selected = None;
    let mut advanced = None;
    let mut paused = false;
    let mut buffering = false;
    let mut seeking = false;
    if let Some((_, kind, id)) = track.as_ref() {
        let kind = match kind {
            TrackKind::Audio => TrackKind::Audio,
            TrackKind::Subtitle => TrackKind::Subtitle,
        };
        player.send(Command::Track {
            session: SESSION.into(),
            kind,
            id: id.to_string(),
        });
    }
    while started.elapsed() < Duration::from_millis(1500) {
        let current_position = position(mpv);
        let now = Instant::now();
        max_clock_gap = max_clock_gap.max(now.duration_since(last_progress));
        if current_position > previous_position {
            advanced.get_or_insert(now.duration_since(started));
            previous_position = current_position;
            last_progress = now;
        }
        for (at, event) in inbox.try_iter() {
            assert_ne!(event["type"], "error", "{event}");
            if at < started {
                continue;
            }
            if event["type"] == "state" {
                paused |= event["state"]["paused"] == true;
                buffering |= event["state"]["buffering"] == true;
                seeking |= event["state"]["seeking"] == true;
            }
            if let Some((media_type, _, id)) = &track
                && event["type"] == "tracks"
                && event["tracks"].as_array().is_some_and(|tracks| {
                    tracks.iter().any(|item| {
                        item["type"].as_str() == Some(*media_type)
                            && item["id"].as_i64() == Some(*id)
                            && item["selected"] == true
                    })
                })
            {
                selected.get_or_insert(at.duration_since(started));
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    println!(
        "{label}: selected_ms={:?}, first_clock_advance_ms={:?}, max_clock_gap_ms={}, clock_advanced_s={:.3}, paused={paused}, buffering={buffering}, seeking={seeking}",
        selected.map(|duration| duration.as_millis()),
        advanced.map(|duration| duration.as_millis()),
        max_clock_gap.as_millis(),
        previous_position - initial_position,
    );
    assert!(
        advanced.is_some(),
        "Playback clock stopped throughout {label}"
    );
    assert!(
        track.is_none() || selected.is_some(),
        "Selected track never took effect in {label}"
    );
}

#[test]
#[ignore = "requires the pinned libmpv and a multi-track MKV"]
fn headless_track_switch_clock() {
    let library = std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap();
    let local = std::env::var("NAVIGATOR_TEST_TRACK_SAMPLE").unwrap();
    let remote = std::env::var("NAVIGATOR_TEST_TRACK_URL").ok();
    let sources = [Some(("local", local)), remote.map(|url| ("https", url))];
    for (source, url) in sources.into_iter().flatten() {
        let mpv = Arc::new(
            Mpv::new(
                std::path::Path::new(&library),
                &[
                    ("config", "no"),
                    ("vo", "null"),
                    ("ao", "null"),
                    ("idle", "yes"),
                    ("terminal", "no"),
                ],
            )
            .unwrap(),
        );
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(
            mpv.clone(),
            move |message| {
                let _ = send.send((Instant::now(), message));
            },
            |_, _| {},
        )
        .unwrap();
        player.send(Command::Load {
            session: SESSION.into(),
            url,
            headers: BTreeMap::new(),
            start_position: 3.0,
        });

        let deadline = Instant::now() + Duration::from_secs(20);
        while position(&mpv) < 3.5 {
            assert!(
                Instant::now() < deadline,
                "Playback did not start for {source}"
            );
            for (_, message) in inbox.try_iter() {
                assert_ne!(message["type"], "error", "{source}: {message}");
            }
            std::thread::sleep(Duration::from_millis(20));
        }

        let tracks = mpv.get_property("track-list", Kind::Json).unwrap();
        let tracks = tracks.as_array().unwrap();
        let commentary = tracks
            .iter()
            .find(|track| track["type"] == "audio" && track["title"] == "Commentary")
            .unwrap();
        assert_ne!(
            commentary["selected"], true,
            "Audio track must be different from the active track"
        );
        let english = tracks
            .iter()
            .find(|track| track["type"] == "sub" && track["lang"] == "eng")
            .unwrap();
        assert_ne!(
            english["selected"], true,
            "Subtitles must be off before selecting English"
        );
        observe(&format!("{source} baseline"), &mpv, &player, &inbox, None);
        observe(
            &format!("{source} audio"),
            &mpv,
            &player,
            &inbox,
            Some((
                "audio",
                TrackKind::Audio,
                commentary["id"].as_i64().unwrap(),
            )),
        );
        observe(
            &format!("{source} subtitles"),
            &mpv,
            &player,
            &inbox,
            Some(("sub", TrackKind::Subtitle, english["id"].as_i64().unwrap())),
        );

        player.begin_shutdown();
        player.join();
    }
}
