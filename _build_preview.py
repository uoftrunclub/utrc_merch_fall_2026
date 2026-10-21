import base64, os, glob
assets = ["img/logo.svg"] + sorted(glob.glob("img/metalvent-*.jpg") + glob.glob("img/swiftly-*.jpg") + glob.glob("img/hoodie-*.jpg"))
assets = [a.replace("\\","/") for a in assets]
def datauri(p):
    ext=p.lower().rsplit(".",1)[1]
    if ext=="svg":
        mime="image/svg+xml"; raw=open(p,"rb").read()
    else:
        mime="image/jpeg" if ext in ("jpg","jpeg") else "image/png"; raw=open(p,"rb").read()
        try:
            from PIL import Image; import io
            im=Image.open(p).convert("RGB")
            w,h=im.size; maxw=760
            if w>maxw:
                im=im.resize((maxw,int(h*maxw/w)))
            buf=io.BytesIO(); im.save(buf,"JPEG",quality=82,optimize=True); raw=buf.getvalue(); mime="image/jpeg"
        except Exception:
            pass
    return f"data:{mime};base64,"+base64.b64encode(raw).decode()
html=open("index.html",encoding="utf-8").read()
for a in assets:
    html=html.replace(a, datauri(a))
open("preview-artifact.html","w",encoding="utf-8").write(html)
print("wrote preview-artifact.html", round(os.path.getsize("preview-artifact.html")/1024), "KB")
