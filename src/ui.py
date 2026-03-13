from __future__ import annotations

import math
import tkinter as tk
from tkinter import ttk

from .audio import AudioDevice


class VisualizerUI:
    def __init__(self, root: tk.Tk, devices: list[AudioDevice]) -> None:
        self.root = root
        self.root.title("Audio Ring Visualizer")
        self.root.geometry("980x760")
        self.root.minsize(760, 620)
        self.root.configure(bg="#08131b")

        self.device_var = tk.StringVar(value=devices[0].id if devices else "")
        self.running_var = tk.BooleanVar(value=True)
        self.band_count_var = tk.IntVar(value=64)
        self.radius_var = tk.IntVar(value=150)
        self.sensitivity_var = tk.DoubleVar(value=1.15)
        self.smoothing_var = tk.DoubleVar(value=0.18)
        self.status_var = tk.StringVar(value="Ready")

        self._device_map = {device.id: device for device in devices}

        self._build_shell(devices)

    def _build_shell(self, devices: list[AudioDevice]) -> None:
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Panel.TFrame", background="#0d1c26")
        style.configure("Panel.TLabel", background="#0d1c26", foreground="#d8e7ef")
        style.configure("Panel.TButton", padding=8)

        container = ttk.Frame(self.root, style="Panel.TFrame", padding=16)
        container.pack(fill="both", expand=True)

        controls = ttk.Frame(container, style="Panel.TFrame")
        controls.pack(fill="x")

        ttk.Label(controls, text="Output Device", style="Panel.TLabel").grid(row=0, column=0, sticky="w")
        device_names = [device.name for device in devices]
        self.device_menu = ttk.Combobox(
            controls,
            state="readonly",
            values=device_names,
            width=34,
        )
        self.device_menu.grid(row=1, column=0, padx=(0, 16), pady=(6, 12), sticky="we")
        self.device_menu.current(0 if devices else -1)

        ttk.Label(controls, text="Bars", style="Panel.TLabel").grid(row=0, column=1, sticky="w")
        band_scale = tk.Scale(
            controls,
            from_=24,
            to=120,
            resolution=4,
            orient="horizontal",
            variable=self.band_count_var,
            bg="#0d1c26",
            fg="#d8e7ef",
            highlightthickness=0,
            troughcolor="#183342",
        )
        band_scale.grid(row=1, column=1, padx=(0, 16), pady=(6, 12), sticky="we")

        ttk.Label(controls, text="Radius", style="Panel.TLabel").grid(row=0, column=2, sticky="w")
        radius_scale = tk.Scale(
            controls,
            from_=90,
            to=230,
            resolution=5,
            orient="horizontal",
            variable=self.radius_var,
            bg="#0d1c26",
            fg="#d8e7ef",
            highlightthickness=0,
            troughcolor="#183342",
        )
        radius_scale.grid(row=1, column=2, padx=(0, 16), pady=(6, 12), sticky="we")

        ttk.Label(controls, text="Sensitivity", style="Panel.TLabel").grid(row=0, column=3, sticky="w")
        sensitivity_scale = tk.Scale(
            controls,
            from_=0.6,
            to=2.2,
            resolution=0.05,
            orient="horizontal",
            variable=self.sensitivity_var,
            bg="#0d1c26",
            fg="#d8e7ef",
            highlightthickness=0,
            troughcolor="#183342",
        )
        sensitivity_scale.grid(row=1, column=3, padx=(0, 16), pady=(6, 12), sticky="we")

        ttk.Label(controls, text="Decay", style="Panel.TLabel").grid(row=0, column=4, sticky="w")
        smoothing_scale = tk.Scale(
            controls,
            from_=0.05,
            to=0.45,
            resolution=0.01,
            orient="horizontal",
            variable=self.smoothing_var,
            bg="#0d1c26",
            fg="#d8e7ef",
            highlightthickness=0,
            troughcolor="#183342",
        )
        smoothing_scale.grid(row=1, column=4, padx=(0, 16), pady=(6, 12), sticky="we")

        self.toggle_button = ttk.Button(controls, text="Pause")
        self.toggle_button.grid(row=1, column=5, pady=(6, 12), sticky="e")

        for column in range(5):
            controls.columnconfigure(column, weight=1)

        self.canvas = tk.Canvas(
            container,
            bg="#08131b",
            highlightthickness=0,
            bd=0,
        )
        self.canvas.pack(fill="both", expand=True, pady=(8, 10))

        footer = ttk.Frame(container, style="Panel.TFrame")
        footer.pack(fill="x")
        ttk.Label(footer, textvariable=self.status_var, style="Panel.TLabel").pack(side="left")

    def get_selected_device_id(self) -> str:
        selected = self.device_menu.get()
        for device_id, device in self._device_map.items():
            if device.name == selected:
                return device_id
        return next(iter(self._device_map), "")

    def set_selected_device(self, device_id: str) -> None:
        device = self._device_map.get(device_id)
        if device is None:
            if self.device_menu["values"]:
                self.device_menu.current(0)
            return
        self.device_menu.set(device.name)

    def set_status(self, text: str) -> None:
        self.status_var.set(text)

    def set_running_button(self, running: bool) -> None:
        self.toggle_button.configure(text="Pause" if running else "Resume")

    def draw(self, levels: list[float]) -> None:
        width = max(1, self.canvas.winfo_width())
        height = max(1, self.canvas.winfo_height())
        cx = width / 2
        cy = height / 2
        inner_radius = self.radius_var.get()
        max_length = min(width, height) * 0.17
        bar_width = 5
        peak_width = 2

        self.canvas.delete("all")
        self.canvas.create_oval(
            cx - inner_radius,
            cy - inner_radius,
            cx + inner_radius,
            cy + inner_radius,
            fill="#0d1c26",
            outline="#173646",
            width=2,
        )
        self.canvas.create_text(
            cx,
            cy - 12,
            text="AUDIO RING",
            fill="#e7f6ff",
            font=("Segoe UI Semibold", 22),
        )
        self.canvas.create_text(
            cx,
            cy + 18,
            text=self.device_menu.get() or "No Device",
            fill="#8eb4c7",
            font=("Segoe UI", 11),
        )

        total = max(1, len(levels))
        for index, level in enumerate(levels):
            angle = math.tau * index / total - math.pi / 2
            bar_length = 16 + level * max_length
            peak_length = bar_length + 7

            start_x = cx + math.cos(angle) * (inner_radius + 10)
            start_y = cy + math.sin(angle) * (inner_radius + 10)
            end_x = cx + math.cos(angle) * (inner_radius + bar_length)
            end_y = cy + math.sin(angle) * (inner_radius + bar_length)
            peak_x = cx + math.cos(angle) * (inner_radius + peak_length)
            peak_y = cy + math.sin(angle) * (inner_radius + peak_length)

            color = _band_color(index, total, level)
            self.canvas.create_line(
                start_x,
                start_y,
                end_x,
                end_y,
                fill=color,
                width=bar_width,
                capstyle=tk.ROUND,
            )
            self.canvas.create_line(
                end_x,
                end_y,
                peak_x,
                peak_y,
                fill="#f4fbff",
                width=peak_width,
                capstyle=tk.ROUND,
            )


def _band_color(index: int, total: int, level: float) -> str:
    ratio = index / max(1, total - 1)
    red = int(60 + 180 * (1.0 - ratio) + 15 * level)
    green = int(135 + 75 * ratio + 20 * level)
    blue = int(210 + 35 * math.sin(ratio * math.pi))
    red = max(0, min(255, red))
    green = max(0, min(255, green))
    blue = max(0, min(255, blue))
    return f"#{red:02x}{green:02x}{blue:02x}"
