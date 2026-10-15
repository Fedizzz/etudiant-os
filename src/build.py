"""Génère etudiant-os.html (artifact autonome) à partir de StudentOS.tsx."""
import re, pathlib
here = pathlib.Path(__file__).parent
src = (here / "StudentOS.tsx").read_text()
src = re.sub(r'^import React, \{([^}]*)\} from "react";', r'const {\1} = React;', src, flags=re.M)
src = re.sub(r'^import \{([^}]*)\} from "lucide-react";', r'const {\1} = Icons;', src, flags=re.M | re.S)
src = re.sub(r'^import \{([^}]*)\} from "react-dom";', r'const {\1} = ReactDOM;', src, flags=re.M)
src = src.replace("export default function StudentOS", "function StudentOS")
tpl = (here / "shell.html").read_text()
(here.parent / "etudiant-os.html").write_text(tpl.replace("/*__APP__*/", src.replace("</script", "<\\/script")))

# Version site web autonome (doctype + viewport) à héberger telle quelle : site/index.html
page = (here.parent / "etudiant-os.html").read_text()
(here.parent).mkdir(exist_ok=True)
(here.parent / "index.html").write_text(
    '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="theme-color" content="#eeecf4">\n'
    + page.replace("<div id=\"root\">", "</head>\n<body>\n<div id=\"root\">", 1)
    + "\n</body>\n</html>\n")
