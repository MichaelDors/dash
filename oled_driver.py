"""
OLED driver for SH1106 128x64 display.
Converts images to 1-bit SH1106 page format and sends via SPI.
Used when rendering the OLED view from HTML/CSS (e.g. Playwright screenshot).
"""

from __future__ import annotations

import io
from typing import Any, Callable, List, Optional, Union

try:
    from PIL import Image

    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False
    Image = None  # type: ignore[assignment, misc]

DISPLAY_WIDTH = 128
DISPLAY_HEIGHT = 64
PAGES = 8  # 64 / 8
BYTES_PER_PAGE = 128

# Brightness levels (SH1106 contrast)
DISPLAY_FULL_BRIGHTNESS = 0xCF
DISPLAY_DIM_BRIGHTNESS = 0x10


def image_to_sh1106_pages(
    source: Union[bytes, "Image.Image"],
) -> List[List[int]]:
    """
    Convert an image (PIL Image or PNG bytes) to SH1106 page format.
    Image is resized to 128x64, converted to 1-bit (threshold 128), then
    packed into 8 pages of 128 bytes each (column-major, page 0 = rows 0-7).
    """
    if not PIL_AVAILABLE or Image is None:
        return [list([0] * BYTES_PER_PAGE) for _ in range(PAGES)]

    if isinstance(source, bytes):
        img = Image.open(io.BytesIO(source)).convert("RGB")
    else:
        img = source.convert("RGB")

    # Resize to display dimensions (stretch if needed)
    resample = getattr(Image, "Resampling", Image).LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
    img = img.resize((DISPLAY_WIDTH, DISPLAY_HEIGHT), resample)
    # Grayscale: use luminance
    gray = img.convert("L")
    # 1-bit: threshold at 128 (above = white = 1)
    binary = gray.point(lambda p: 255 if p >= 128 else 0, mode="1")

    # SH1106 page format: 8 pages, each page has 128 columns, each column is 8 pixels (1 byte)
    # page_data[page][col] = byte for rows (page*8) to (page*8+7)
    display_data: List[List[int]] = []
    pixels = binary.load()

    for page in range(PAGES):
        page_data: List[int] = []
        for col in range(DISPLAY_WIDTH):
            byte = 0
            for bit in range(8):
                row = page * 8 + bit
                if row < DISPLAY_HEIGHT and pixels[col, row]:
                    byte |= 1 << bit
            page_data.append(byte)
        display_data.append(page_data)

    return display_data


class SH1106Driver:
    """
    SH1106 SPI driver. Requires spi.xfer([byte]) and GPIO.output(pin, value).
    """

    def __init__(
        self,
        spi: Any,
        gpio_output: Callable[[int, int], None],
        a0_pin: int,
        resn_pin: int,
    ) -> None:
        self._spi = spi
        self._gpio_output = gpio_output
        self._a0 = a0_pin
        self._resn = resn_pin
        self._contrast = DISPLAY_FULL_BRIGHTNESS

    def _send_command(self, cmd: int) -> None:
        self._gpio_output(self._a0, 0)  # LOW = command
        self._spi.xfer([cmd])

    def _send_data(self, data: List[int]) -> None:
        self._gpio_output(self._a0, 1)  # HIGH = data
        self._spi.xfer(data)

    def clear_display(self) -> None:
        for page in range(PAGES):
            self._send_command(0xB0 + page)
            self._send_command(0x02)
            self._send_command(0x10)
            self._send_data([0] * BYTES_PER_PAGE)

    def init_display(self) -> None:
        """Hardware reset and SH1106 init sequence."""
        self._gpio_output(self._resn, 0)
        import time

        time.sleep(0.1)
        self._gpio_output(self._resn, 1)
        time.sleep(0.1)

        self._send_command(0xAE)  # Display OFF
        self._send_command(0xD5)
        self._send_command(0x80)
        self._send_command(0xA8)
        self._send_command(0x3F)
        self._send_command(0xD3)
        self._send_command(0x00)
        self._send_command(0x40)
        self._send_command(0xAD)  # DC-DC control (SH1106)
        self._send_command(0x8B)  # DC-DC ON
        self._send_command(0xA0)
        self._send_command(0xC0)
        self._send_command(0xDA)
        self._send_command(0x12)
        self._send_command(0x81)
        self._send_command(self._contrast)
        self._send_command(0xD9)
        self._send_command(0xF1)
        self._send_command(0xDB)
        self._send_command(0x40)
        self._send_command(0xA4)
        self._send_command(0xA6)
        self.clear_display()
        self._send_command(0xAF)  # Display ON
        time.sleep(0.15)  # Let DC-DC stabilize before writing frame data

    def display_frame(self, page_data: List[List[int]]) -> None:
        """Send 8 pages of 128 bytes each to the display."""
        for page in range(PAGES):
            self._send_command(0xB0 + page)
            self._send_command(0x02)
            self._send_command(0x10)
            self._send_data(page_data[page])

    def set_contrast(self, value: int) -> None:
        self._contrast = value
        self._send_command(0x81)
        self._send_command(value)

    def turn_off(self) -> None:
        self._send_command(0xAE)

    def turn_on(self) -> None:
        self._send_command(0xAF)
        self.set_contrast(self._contrast)
