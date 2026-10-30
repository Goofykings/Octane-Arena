"""Bake a small original carton decal. Run with Python + Pillow before the Blender build."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

image = Image.new('RGBA', (256, 64))
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 35)
draw.text((128, 32), 'Octane Fries', font=font, anchor='mm', fill='white')
image.save(Path(__file__).with_name('octane-fries-label.png'), optimize=True)
