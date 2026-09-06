"""Animate only the three yellow lights in AIAng.png using ffmpeg.

Requires ffmpeg on PATH. Keeps the logo stationary and preserves transparency.
"""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
# Each light fades once per 1.5-second loop, offset by one third of a cycle.
phase = 'if(lt(X,W*0.32),0,if(lt(X,W*0.44),1/3,2/3))'
pulse = f'(0.28+0.72*pow((1+cos(2*PI*(T/1.5-({phase}))))/2,2))'
mask = 'lt(Y,H*0.2)*gt(r(X,Y),100)*gt(g(X,Y),90)*lt(b(X,Y),180)*gt(g(X,Y),b(X,Y)*1.25)'
channels = ':'.join(f"{c}='if({mask},{c}(X,Y)*{pulse},{c}(X,Y))'" for c in ('r', 'g', 'b'))
filters = (f"fps=20,scale=256:256:flags=lanczos,format=rgba,geq={channels}:a='alpha(X,Y)',"
           "split[frames][colors];[colors]palettegen=reserve_transparent=1:transparency_color=0xFFFFFF[palette];"
           "[frames][palette]paletteuse=dither=bayer:bayer_scale=3:alpha_threshold=128")
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-loop', '1',
                '-t', '1.5', '-i', str(root / 'icons/AIAng.png'),
                '-filter_complex', filters, '-loop', '0', str(root / 'icons/AIAng.gif')], check=True)
