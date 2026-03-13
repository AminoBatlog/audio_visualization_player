from __future__ import annotations

import tkinter as tk

from .audio import create_audio_source, list_output_devices
from .config import AppSettings, load_settings, save_settings
from .signal import LevelSmoother
from .ui import VisualizerUI


class VisualizerApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.devices = list_output_devices()
        self.settings = load_settings()
        self.ui = VisualizerUI(root, self.devices)
        self._applying_settings = True
        self._apply_loaded_settings()
        self.source = create_audio_source(self.ui.get_selected_device_id())
        self.smoother = LevelSmoother(self.ui.band_count_var.get())
        self._frame_ms = 33
        self._job: str | None = None

        self.ui.toggle_button.configure(command=self.toggle_running)
        self.ui.device_menu.bind("<<ComboboxSelected>>", self.on_device_changed)
        self.ui.band_count_var.trace_add("write", self.on_setting_changed)
        self.ui.radius_var.trace_add("write", self.on_setting_changed)
        self.ui.sensitivity_var.trace_add("write", self.on_setting_changed)
        self.ui.smoothing_var.trace_add("write", self.on_setting_changed)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._applying_settings = False
        self.on_device_changed()
        self.ui.set_running_button(self.ui.running_var.get())
        if self.ui.running_var.get():
            self.tick()
        else:
            self.ui.draw([0.0] * self.ui.band_count_var.get())

    def _apply_loaded_settings(self) -> None:
        available_ids = {device.id for device in self.devices}
        device_id = self.settings.device_id if self.settings.device_id in available_ids else "demo"
        self.ui.set_selected_device(device_id)
        self.ui.band_count_var.set(self.settings.band_count)
        self.ui.radius_var.set(self.settings.radius)
        self.ui.sensitivity_var.set(self.settings.sensitivity)
        self.ui.smoothing_var.set(self.settings.smoothing)
        self.ui.running_var.set(self.settings.running)

    def on_device_changed(self, *_args: object) -> None:
        device_id = self.ui.get_selected_device_id()
        self.source.close()
        try:
            self.source = create_audio_source(device_id)
        except Exception as exc:
            self.source = create_audio_source("demo")
            self.ui.set_selected_device("demo")
            self.ui.set_status(f"Capture unavailable, fallback to demo: {exc}")
            self.persist_settings()
            return

        device = next((item for item in self.devices if item.id == device_id), None)
        if device is None:
            self.ui.set_status("Using demo source")
            self.persist_settings()
            return
        if device.available:
            if device.kind == "output":
                self.ui.set_status(f"Loopback capture active: {device.name}")
            else:
                self.ui.set_status(f"Connected to {device.name}")
            self.persist_settings()
            return
        self.ui.set_status(f"{device.name}: capture backend not connected yet")
        self.persist_settings()

    def on_setting_changed(self, *_args: object) -> None:
        self.smoother.resize(self.ui.band_count_var.get())
        if self._applying_settings:
            return
        self.persist_settings()

    def toggle_running(self) -> None:
        running = not self.ui.running_var.get()
        self.ui.running_var.set(running)
        self.ui.set_running_button(running)
        self.persist_settings()
        if running:
            self.tick()

    def tick(self) -> None:
        if not self.ui.running_var.get():
            return

        band_count = self.ui.band_count_var.get()
        raw_levels = self.source.read_levels(band_count)
        self.smoother.decay = self.ui.smoothing_var.get()
        levels = self.smoother.update(raw_levels, self.ui.sensitivity_var.get())
        self.ui.draw(levels)
        self._job = self.root.after(self._frame_ms, self.tick)

    def persist_settings(self) -> None:
        save_settings(
            AppSettings(
                device_id=self.ui.get_selected_device_id(),
                band_count=self.ui.band_count_var.get(),
                radius=self.ui.radius_var.get(),
                sensitivity=self.ui.sensitivity_var.get(),
                smoothing=self.ui.smoothing_var.get(),
                running=self.ui.running_var.get(),
            )
        )

    def on_close(self) -> None:
        if self._job is not None:
            self.root.after_cancel(self._job)
        self.persist_settings()
        self.source.close()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    VisualizerApp(root)
    root.mainloop()
