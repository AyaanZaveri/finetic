//! Frame-driven D3D11 output. mpv renders into our texture; glass never asks
//! mpv or DWM for a screenshot. GPU readback uses three nonblocking tiny slots.
use crate::{
    glass::{Control, Ticket},
    mpv::Mpv,
    render::RenderContext,
    windows_hdr::{self, Output, Transition},
};
use std::{
    sync::{Arc, Condvar, Mutex, mpsc},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::Fxc::{D3DCOMPILE_OPTIMIZATION_LEVEL3, D3DCompile},
            Direct3D::*,
            Direct3D11::*,
            Dxgi::Common::*,
            Dxgi::*,
        },
    },
    core::{Interface, PCSTR, Result as WinResult},
};

#[derive(Default)]
struct State {
    size: (u32, u32),
    visible: bool,
    wake: bool,
    stop: bool,
    source_hdr: bool,
    peak_override: Option<u32>,
    display_dirty: bool,
    output_reply: Option<(u64, Result<(), String>)>,
}
pub struct Host {
    hwnd: usize,
    state: Arc<(Mutex<State>, Condvar)>,
    worker: Mutex<Option<JoinHandle<()>>>,
}
impl Host {
    pub fn new(hwnd: usize, width: u32, height: u32) -> Arc<Self> {
        Arc::new(Self {
            hwnd,
            state: Arc::new((
                Mutex::new(State {
                    size: (width, height),
                    visible: true,
                    wake: true,
                    stop: false,
                    display_dirty: true,
                    ..Default::default()
                }),
                Condvar::new(),
            )),
            worker: Mutex::new(None),
        })
    }
    pub fn resize(&self, width: u32, height: u32) {
        let mut s = self.state.0.lock().unwrap();
        s.size = (width, height);
        s.wake = true;
        self.state.1.notify_one();
    }
    pub fn visible(&self, visible: bool) {
        let mut s = self.state.0.lock().unwrap();
        if s.visible != visible {
            s.visible = visible;
            s.wake = true;
            self.state.1.notify_one();
        }
    }
    pub fn source_color(&self, gamma: Option<String>, primaries: Option<String>) {
        let hdr = windows_hdr::hdr_source(gamma.as_deref(), primaries.as_deref());
        let mut state = self.state.0.lock().unwrap();
        if state.source_hdr != hdr {
            state.source_hdr = hdr;
            state.wake = true;
            self.state.1.notify_one();
        }
    }
    pub fn set_hdr_peak(&self, nits: Option<u32>) {
        let mut state = self.state.0.lock().unwrap();
        if state.peak_override != nits {
            state.peak_override = nits;
            state.wake = true;
            self.state.1.notify_one();
        }
    }
    pub fn refresh_display(&self) {
        let mut state = self.state.0.lock().unwrap();
        state.display_dirty = true;
        state.wake = true;
        self.state.1.notify_one();
    }
    pub fn start(
        &self,
        mpv: Arc<Mpv>,
        glass: Control,
        on_error: impl Fn(String) + Send + 'static,
    ) -> Result<(), String> {
        let mut worker = self.worker.lock().unwrap();
        if worker.is_some() {
            return Ok(());
        }
        let state = self.state.clone();
        let hwnd = self.hwnd;
        let (ready, initialized) = mpsc::sync_channel(1);
        let demand = state.clone();
        glass.on_demand(Arc::new(move || {
            let mut s = demand.0.lock().unwrap();
            s.wake = true;
            demand.1.notify_one();
        }));
        *worker = Some(
            std::thread::Builder::new()
                .name("navigator-d3d11".into())
                .spawn(move || {
                    let mut started = false;
                    let result = unsafe { run(hwnd, state, mpv, glass, &ready, &mut started) };
                    if let Err(e) = result {
                        let _ = ready.send(Err(e.to_string()));
                        log::error!("Native D3D11 output: {e}");
                        if started {
                            on_error(e.to_string());
                        }
                    }
                })
                .map_err(|e| e.to_string())?,
        );
        initialized.recv().map_err(|e| e.to_string())?
    }
    pub fn begin_shutdown(&self) {
        {
            let mut s = self.state.0.lock().unwrap();
            s.stop = true;
            s.wake = true;
            self.state.1.notify_one();
        }
    }
    pub fn finished(&self) -> bool {
        self.worker
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|w| w.is_finished())
    }
    pub fn shutdown(&self) {
        self.begin_shutdown();
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}

// Keep blocking client property calls off both the UI and render threads.
// The render loop continues consuming mpv callbacks during each transaction,
// but holds presentation until every output property has been acknowledged.
struct OutputWorker {
    requests: Option<mpsc::Sender<(u64, Output)>>,
    worker: Option<JoinHandle<()>>,
}
impl OutputWorker {
    fn new(mpv: Arc<Mpv>, state: Arc<(Mutex<State>, Condvar)>) -> WinResult<Self> {
        let (sender, receiver) = mpsc::channel::<(u64, Output)>();
        let worker = std::thread::Builder::new()
            .name("navigator-hdr-config".into())
            .spawn(move || {
                while let Ok((generation, output)) = receiver.recv() {
                    let result = output.options().into_iter().try_for_each(|(name, value)| {
                        mpv.set_property(name, &value)
                            .map_err(|error| format!("{name}: {error}"))
                    });
                    let mut state_value = state.0.lock().unwrap();
                    state_value.output_reply = Some((generation, result));
                    state_value.wake = true;
                    state.1.notify_one();
                }
            })
            .map_err(|error| native_error(error.to_string()))?;
        Ok(Self {
            requests: Some(sender),
            worker: Some(worker),
        })
    }
    fn request(&self, request: (u64, Output)) -> WinResult<()> {
        self.requests
            .as_ref()
            .unwrap()
            .send(request)
            .map_err(|error| native_error(error.to_string()))
    }
}
impl Drop for OutputWorker {
    fn drop(&mut self) {
        self.requests.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn native_error(message: String) -> windows::core::Error {
    windows::core::Error::new(windows::Win32::Foundation::E_FAIL, message)
}

#[derive(Clone, Copy, Debug, Default)]
struct DisplayColor {
    hdr: bool,
    peak: f32,
}

unsafe fn display_color(hwnd: usize) -> WinResult<DisplayColor> {
    // Fresh enumeration avoids stale DXGI output descriptions after an HDR
    // setting change. Match the video window, including on hybrid-GPU laptops.
    unsafe {
        let monitor = windows_sys::Win32::Graphics::Gdi::MonitorFromWindow(
            hwnd as _,
            windows_sys::Win32::Graphics::Gdi::MONITOR_DEFAULTTONEAREST,
        );
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let mut adapter_index = 0;
        loop {
            let adapter = match factory.EnumAdapters1(adapter_index) {
                Ok(adapter) => adapter,
                Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(error) => return Err(error),
            };
            adapter_index += 1;
            let mut output_index = 0;
            loop {
                let output = match adapter.EnumOutputs(output_index) {
                    Ok(output) => output,
                    Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                    Err(error) => return Err(error),
                };
                output_index += 1;
                if output.GetDesc()?.Monitor.0 != monitor {
                    continue;
                }
                let output: IDXGIOutput6 = output.cast()?;
                let desc = output.GetDesc1()?;
                return Ok(DisplayColor {
                    hdr: desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020,
                    peak: desc.MaxLuminance,
                });
            }
        }
        Ok(DisplayColor::default())
    }
}

fn output_format(output: Output) -> DXGI_FORMAT {
    if output.hdr() {
        DXGI_FORMAT_R10G10B10A2_UNORM
    } else {
        DXGI_FORMAT_B8G8R8A8_UNORM
    }
}
unsafe fn signal_output(swap: &IDXGISwapChain1, output: Output) -> WinResult<()> {
    unsafe {
        let swap: IDXGISwapChain3 = swap.cast()?;
        let color = if output.hdr() {
            DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020
        } else {
            DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709
        };
        if swap.CheckColorSpaceSupport(color)?
            & DXGI_SWAP_CHAIN_COLOR_SPACE_SUPPORT_FLAG_PRESENT.0 as u32
            == 0
        {
            return Err(native_error(format!(
                "Unsupported DXGI output color space {color:?}"
            )));
        }
        swap.SetColorSpace1(color)
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Pending {
    ticket: Ticket,
    sequence: u64,
    started: Instant,
}
struct Slot {
    texture: ID3D11Texture2D,
    pending: Option<Pending>,
}
struct GlassGpu {
    size: (u32, u32),
    target: ID3D11Texture2D,
    rtv: ID3D11RenderTargetView,
    vertex: ID3D11VertexShader,
    pixel: ID3D11PixelShader,
    sampler: ID3D11SamplerState,
    footprint: ID3D11Buffer,
    slots: Vec<Slot>,
    sequence: u64,
    delivered: u64,
}
unsafe fn compile(
    source: &str,
    entry: &std::ffi::CStr,
    target: &std::ffi::CStr,
) -> WinResult<ID3DBlob> {
    let mut blob = None;
    let mut error = None;
    unsafe {
        D3DCompile(
            source.as_ptr().cast(),
            source.len(),
            PCSTR::null(),
            None,
            None,
            PCSTR(entry.as_ptr().cast()),
            PCSTR(target.as_ptr().cast()),
            D3DCOMPILE_OPTIMIZATION_LEVEL3,
            0,
            &mut blob,
            Some(&mut error),
        )
    }?;
    Ok(blob.unwrap())
}
unsafe fn texture(
    device: &ID3D11Device,
    size: (u32, u32),
    staging: bool,
) -> WinResult<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: size.0,
        Height: size.1,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: if staging {
            D3D11_USAGE_STAGING
        } else {
            D3D11_USAGE_DEFAULT
        },
        BindFlags: if staging {
            0
        } else {
            (D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE).0 as u32
        },
        CPUAccessFlags: if staging {
            D3D11_CPU_ACCESS_READ.0 as u32
        } else {
            0
        },
        MiscFlags: 0,
    };
    let mut result = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut result)) }?;
    Ok(result.unwrap())
}
impl GlassGpu {
    unsafe fn new(device: &ID3D11Device, size: (u32, u32)) -> WinResult<Self> {
        unsafe {
            let scale = (640.0 / size.0 as f64).min(360.0 / size.1 as f64).min(1.0);
            let size = (
                (size.0 as f64 * scale).round().max(1.0) as u32,
                (size.1 as f64 * scale).round().max(1.0) as u32,
            );
            let source = include_str!("windows_hdr_sample.hlsl");
            let vs = compile(source, c"vs", c"vs_4_0")?;
            let ps = compile(source, c"ps", c"ps_4_0")?;
            let mut vertex = None;
            let mut pixel = None;
            device.CreateVertexShader(
                std::slice::from_raw_parts(vs.GetBufferPointer().cast(), vs.GetBufferSize()),
                None,
                Some(&mut vertex),
            )?;
            device.CreatePixelShader(
                std::slice::from_raw_parts(ps.GetBufferPointer().cast(), ps.GetBufferSize()),
                None,
                Some(&mut pixel),
            )?;
            let mut footprint = None;
            let values = [1.0f32 / size.0 as f32, 1.0f32 / size.1 as f32, 0.0, 0.0];
            device.CreateBuffer(
                &D3D11_BUFFER_DESC {
                    ByteWidth: 16,
                    Usage: D3D11_USAGE_DEFAULT,
                    BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
                    ..Default::default()
                },
                Some(&D3D11_SUBRESOURCE_DATA {
                    pSysMem: values.as_ptr().cast(),
                    ..Default::default()
                }),
                Some(&mut footprint),
            )?;
            let target = texture(device, size, false)?;
            let mut rtv = None;
            device.CreateRenderTargetView(&target, None, Some(&mut rtv))?;
            let mut sampler = None;
            device.CreateSamplerState(
                &D3D11_SAMPLER_DESC {
                    Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
                    AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                    AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                    AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                    MaxLOD: f32::MAX,
                    ComparisonFunc: D3D11_COMPARISON_NEVER,
                    ..Default::default()
                },
                Some(&mut sampler),
            )?;
            let mut slots = Vec::new();
            for _ in 0..3 {
                slots.push(Slot {
                    texture: texture(device, size, true)?,
                    pending: None,
                });
            }
            Ok(Self {
                size,
                target,
                rtv: rtv.unwrap(),
                vertex: vertex.unwrap(),
                pixel: pixel.unwrap(),
                sampler: sampler.unwrap(),
                footprint: footprint.unwrap(),
                slots,
                sequence: 0,
                delivered: 0,
            })
        }
    }
    fn pending(&self) -> bool {
        self.slots.iter().any(|s| s.pending.is_some())
    }
    unsafe fn resize(&mut self, device: &ID3D11Device, size: (u32, u32)) -> WinResult<()> {
        unsafe {
            let scale = (640.0 / size.0 as f64).min(360.0 / size.1 as f64).min(1.0);
            let size = (
                (size.0 as f64 * scale).round().max(1.0) as u32,
                (size.1 as f64 * scale).round().max(1.0) as u32,
            );
            for slot in &mut self.slots {
                slot.pending = None;
            }
            if self.size == size {
                return Ok(());
            }
            self.target = texture(device, size, false)?;
            let mut rtv = None;
            device.CreateRenderTargetView(&self.target, None, Some(&mut rtv))?;
            self.rtv = rtv.unwrap();
            for slot in &mut self.slots {
                slot.texture = texture(device, size, true)?;
            }
            self.size = size;
            Ok(())
        }
    }
    unsafe fn collect(&mut self, context: &ID3D11DeviceContext, glass: &Control) {
        unsafe {
            for slot in &mut self.slots {
                if slot.pending.is_none() {
                    continue;
                }
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                match context.Map(
                    &slot.texture,
                    0,
                    D3D11_MAP_READ,
                    D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                    Some(&mut mapped),
                ) {
                    Ok(()) => {
                        let pending = slot.pending.take().unwrap();
                        if pending.sequence > self.delivered
                            && glass.ticket().as_ref() == Some(&pending.ticket)
                        {
                            let stride = self.size.0 as usize * 4;
                            let mut pixels = vec![0; stride * self.size.1 as usize];
                            for y in 0..self.size.1 as usize {
                                std::ptr::copy_nonoverlapping(
                                    mapped.pData.cast::<u8>().add(y * mapped.RowPitch as usize),
                                    pixels.as_mut_ptr().add(y * stride),
                                    stride,
                                );
                            }
                            self.delivered = pending.sequence;
                            glass.submit(
                                pending.ticket,
                                pixels,
                                self.size.0 as usize,
                                self.size.1 as usize,
                                stride,
                                pending.started,
                            );
                            log::trace!(
                                "glass GPU readback ready in {:.2} ms",
                                pending.started.elapsed().as_secs_f64() * 1000.0
                            );
                        }
                        context.Unmap(&slot.texture, 0);
                    }
                    Err(e) if e.code() == DXGI_ERROR_WAS_STILL_DRAWING => {}
                    Err(e) => {
                        log::warn!("Glass readback: {e}");
                        slot.pending = None;
                    }
                }
            }
        }
    }
    unsafe fn capture(
        &mut self,
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        source: &ID3D11Texture2D,
        ticket: Ticket,
        hdr: bool,
    ) -> WinResult<bool> {
        unsafe {
            let Some(slot) = self.slots.iter_mut().find(|s| s.pending.is_none()) else {
                return Ok(false);
            };
            let mut srv = None;
            device.CreateShaderResourceView(source, None, Some(&mut srv))?;
            context.ClearState();
            context.OMSetRenderTargets(Some(&[Some(self.rtv.clone())]), None);
            context.RSSetViewports(Some(&[D3D11_VIEWPORT {
                Width: self.size.0 as f32,
                Height: self.size.1 as f32,
                MaxDepth: 1.0,
                ..Default::default()
            }]));
            context.IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            context.VSSetShader(&self.vertex, None);
            context.PSSetShader(&self.pixel, None);
            let footprint = [
                1.0f32 / self.size.0 as f32,
                1.0f32 / self.size.1 as f32,
                if hdr { 1.0 } else { 0.0 },
                0.0,
            ];
            context.UpdateSubresource(&self.footprint, 0, None, footprint.as_ptr().cast(), 0, 0);
            context.PSSetConstantBuffers(0, Some(&[Some(self.footprint.clone())]));
            context.PSSetShaderResources(0, Some(&[srv]));
            context.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
            context.Draw(3, 0);
            context.PSSetShaderResources(0, Some(&[None]));
            context.CopyResource(&slot.texture, &self.target);
            self.sequence += 1;
            slot.pending = Some(Pending {
                ticket,
                sequence: self.sequence,
                started: Instant::now(),
            });
            Ok(true)
        }
    }
}

unsafe fn run(
    hwnd: usize,
    state: Arc<(Mutex<State>, Condvar)>,
    mpv: Arc<Mpv>,
    glass: Control,
    ready: &mpsc::SyncSender<Result<(), String>>,
    started: &mut bool,
) -> WinResult<()> {
    unsafe {
        let mut device = None;
        let mut context = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let device = device.unwrap();
        let context = context.unwrap();
        let dxgi: IDXGIDevice = device.cast()?;
        let factory: IDXGIFactory2 = dxgi.GetAdapter()?.GetParent()?;
        let mut size = state.0.lock().unwrap().size;
        size = (size.0.max(1), size.1.max(1));
        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: size.0,
            Height: size.1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT | DXGI_USAGE_SHADER_INPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD,
            AlphaMode: DXGI_ALPHA_MODE_IGNORE,
            ..Default::default()
        };
        let swap =
            factory.CreateSwapChainForHwnd(&device, HWND(hwnd as *mut _), &desc, None, None)?;
        // Tao owns window placement and borderless fullscreen. DXGI must not
        // install a competing message-queue handler for mode transitions.
        factory.MakeWindowAssociation(
            HWND(hwnd as *mut _),
            DXGI_MWA_NO_WINDOW_CHANGES | DXGI_MWA_NO_ALT_ENTER,
        )?;
        signal_output(&swap, Output::Sdr)?;
        // Declared before RenderContext so unwinding frees the render API first.
        // A client call waiting for the renderer must never block its destruction.
        let configuration = OutputWorker::new(mpv.clone(), state.clone())?;
        let mut render = match RenderContext::new_d3d11(mpv, device.as_raw()) {
            Ok(r) => r,
            Err(e) => {
                let _ = ready.send(Err(e));
                return Ok(());
            }
        };
        let callback = state.clone();
        render.on_update(move || {
            let mut s = callback.0.lock().unwrap();
            s.wake = true;
            callback.1.notify_one();
        });
        let mut gpu = GlassGpu::new(&device, size)?;
        let mut last_texture = None;
        let mut last_ticket = None;
        let mut was_visible = true;
        let mut display = DisplayColor::default();
        let mut hdr_failed = false;
        let mut transition = Transition::sdr();
        let mut applied = Output::Sdr;
        let mut surface_dirty = false;
        let mut redraw = false;
        let mut frames = 0u64;
        let mut materials = 0u64;
        let mut report = Instant::now();
        *started = true;
        let _ = ready.send(Ok(()));
        loop {
            let requested = {
                let mut s = state.0.lock().unwrap();
                while !s.wake && !s.stop {
                    if gpu.pending() {
                        s = state.1.wait_timeout(s, Duration::from_millis(1)).unwrap().0;
                        break;
                    }
                    s = state.1.wait(s).unwrap();
                }
                if s.stop {
                    break;
                }
                s.wake = false;
                (
                    s.size,
                    s.visible,
                    s.source_hdr,
                    s.peak_override,
                    std::mem::take(&mut s.display_dirty),
                    s.output_reply.take(),
                )
            };
            let (requested, visible, source_hdr, peak_override, display_dirty, reply) = requested;
            if display_dirty {
                display = display_color(hwnd).unwrap_or_else(|error| {
                    log::warn!("HDR display query failed; using SDR: {error}");
                    DisplayColor::default()
                });
                hdr_failed = false;
                log::info!(
                    "Windows display: HDR={} peak={} nits",
                    display.hdr,
                    display.peak
                );
            }
            if let Some((generation, result)) = reply {
                if let Some(output) = transition.finish(generation, result.is_ok()) {
                    if let Err(error) = result {
                        if !output.hdr() {
                            return Err(native_error(format!(
                                "SDR output restoration failed: {error}"
                            )));
                        }
                        log::warn!("HDR properties rejected; restoring SDR: {error}");
                        hdr_failed = true;
                    }
                    redraw = true;
                }
            }
            gpu.collect(&context, &glass);
            let new_frame = render.update();
            if !visible || requested.0 == 0 || requested.1 == 0 {
                if new_frame {
                    render.skip();
                }
                was_visible = false;
                continue;
            }
            let wanted = windows_hdr::choose(source_hdr, display.hdr && !hdr_failed, display.peak, peak_override);
            if let Some(request) = transition.request(wanted) {
                configuration.request(request)?;
            }
            if !transition.ready(wanted) {
                // Consume render callbacks to unblock the core's property work.
                // Do not present pixels encoded for an intermediate configuration.
                if new_frame {
                    let texture: ID3D11Texture2D = swap.GetBuffer(0)?;
                    context.ClearState();
                    render.draw_d3d11(texture.as_raw()).map_err(native_error)?;
                }
                continue;
            }
            let resized = requested != size;
            let output_changed = wanted != applied;
            if resized || surface_dirty || wanted.hdr() != applied.hdr() {
                context.ClearState();
                last_texture.take();
                let change = swap
                    .ResizeBuffers(
                        2,
                        requested.0,
                        requested.1,
                        output_format(wanted),
                        DXGI_SWAP_CHAIN_FLAG(0),
                    )
                    .and_then(|()| signal_output(&swap, wanted));
                if let Err(error) = change {
                    if !wanted.hdr() {
                        return Err(error);
                    }
                    log::warn!("HDR swap chain rejected; restoring SDR: {error}");
                    hdr_failed = true;
                    surface_dirty = true;
                    let mut s = state.0.lock().unwrap();
                    s.wake = true;
                    state.1.notify_one();
                    continue;
                }
                size = requested;
                surface_dirty = false;
                redraw = true;
                gpu.resize(&device, size)?;
                last_ticket = None;
            }
            applied = wanted;
            if new_frame || redraw || output_changed || !was_visible {
                let texture: ID3D11Texture2D = swap.GetBuffer(0)?;
                context.ClearState();
                render.draw_d3d11(texture.as_raw()).map_err(|e| {
                    windows::core::Error::new(windows::Win32::Foundation::E_FAIL, e)
                })?;
                frames += 1;
                let ticket = glass.ticket();
                if let Some(ticket) = ticket {
                    if gpu.capture(&device, &context, &texture, ticket.clone(), applied.hdr())? {
                        last_ticket = Some(ticket);
                        materials += 1;
                    }
                }
                // Present submits the readback too; the next loop only maps a
                // completed slot, and never stalls the video waiting for it.
                swap.Present(0, DXGI_PRESENT(0)).ok()?;
                render.report_swap();
                if output_changed {
                    log::info!(
                        "Windows video output: {applied:?}, format={:?}, source_hdr={source_hdr}",
                        output_format(applied)
                    );
                }
                redraw = false;
                last_texture = Some(texture);
            } else if let Some(ticket) = glass.ticket() {
                if last_ticket.as_ref() != Some(&ticket) {
                    if let Some(texture) = &last_texture {
                        if gpu.capture(&device, &context, texture, ticket.clone(), applied.hdr())? {
                            last_ticket = Some(ticket);
                            materials += 1;
                            context.Flush();
                        }
                    }
                }
            }
            was_visible = true;
            if report.elapsed() >= Duration::from_secs(2) {
                log::debug!(
                    "D3D11: {:.1} video fps, {:.1} glass submissions/sec",
                    frames as f64 / report.elapsed().as_secs_f64(),
                    materials as f64 / report.elapsed().as_secs_f64()
                );
                frames = 0;
                materials = 0;
                report = Instant::now();
            }
        }
        context.ClearState();
        drop(render);
        Ok(())
    }
}
