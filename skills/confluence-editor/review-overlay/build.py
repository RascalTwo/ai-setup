"""Inline changes.json into the overlay: python3 build.py changes.json > crv-bundle.js"""
import os, sys
tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "overlay.tpl.js")).read()
sys.stdout.write(tpl.replace("__DATA__", open(sys.argv[1]).read()))
