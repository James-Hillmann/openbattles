"""
Report which unit sprite frames are visible in each screenshot of a burst
(bottom screen), matching opaque pixels exactly at 5-bit color depth.

  python tools/emu/track.py <burst dir> <frame px> '<sheet png glob>'

Sheets come from extract/cli/sheets.ts. The selection outline color (cyan in the
palette, yellow on screen) is ignored so selected units match too.
"""
import sys, glob, os
from PIL import Image
import numpy as np
fw=int(sys.argv[2]); pat=sys.argv[3]
frames=[]
for f in sorted(glob.glob(pat)):
    sh=np.array(Image.open(f).convert('RGBA')).astype(int); sh[:,:,:3]>>=3
    for fy in range(0, sh.shape[0]-fw+1, fw):
        for fx in range(0, sh.shape[1]-fw+1, fw):
            fr=sh[fy:fy+fw,fx:fx+fw]; m=(fr[:,:,3]>0)&~((fr[:,:,0]==0)&(fr[:,:,1]==31)&(fr[:,:,2]==27))
            if m.sum()<60: continue
            for flip in (0,1):
                g=fr[:, ::-1] if flip else fr; mm=m[:, ::-1] if flip else m
                ys,xs=np.nonzero(mm); frames.append((os.path.basename(f)[:-4],fx//fw,fy//fw,flip,ys,xs,g[ys,xs,:3]))
prev=None
for s in sorted(glob.glob(sys.argv[1]+'/*.png')):
    shot=np.array(Image.open(s).convert('RGB')).astype(int)[192:]>>3; H,W,_=shot.shape
    found=[]
    for (n,c,r,fl,ys,xs,rgb) in frames:
        c0=rgb[0]
        cand=np.argwhere((shot[:,:,0]==c0[0])&(shot[:,:,1]==c0[1])&(shot[:,:,2]==c0[2]))
        best=None
        for (y,x) in cand:
            oy=y-ys[0]; ox=x-xs[0]
            if oy<0 or ox<0 or oy+fw>H or ox+fw>W: continue
            ok=(shot[oy+ys,ox+xs]==rgb).all(axis=1).mean()
            if ok>0.97: best=(ox,oy); break
        if best: found.append(f'{n}[{r},{c}]{"F" if fl else ""}@{best[0]},{best[1]}')
    print(os.path.basename(s), ' '.join(found))
