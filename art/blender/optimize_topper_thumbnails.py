"""Compress Blender thumbnails using a small fixed PNG palette."""
from pathlib import Path
from PIL import Image

for path in (Path(__file__).parents[2] / 'public/images/toppers').glob('*.png'):
    image = Image.open(path).convert('RGB')
    image.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
