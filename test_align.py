import sys
from PIL import Image, ImageDraw, ImageFont

img = Image.new("1", (128, 64), 0)
draw = ImageDraw.Draw(img)

try:
    font = ImageFont.truetype("SF-Compact-Rounded-Light.otf", 12)
except Exception:
    font = ImageFont.load_default()

print("Bbox track lt:", draw.textbbox((0, 0), "Test Track", font=font, anchor="lt"))
print("Bbox time lt:", draw.textbbox((0, 0), "12:34", font=font, anchor="lt"))
