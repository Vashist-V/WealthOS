"""Keeping the server inside a small machine's memory.

A free host gives the server 512 MB and stops it the moment it uses more.
Python, and the C library under it, both hold on to memory they have finished
with so they can reuse it quickly; on a machine this small that held-back
memory is the difference between running and being stopped. So after any piece
of heavy work the server hands back what it no longer needs, and it can report
how much it is using.
"""
from __future__ import annotations

import ctypes
import gc
import sys


def release() -> None:
    """Hand memory that is no longer in use back to the system."""
    gc.collect()
    if sys.platform.startswith("linux"):
        try:
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except (OSError, AttributeError):  # a C library without it
            pass


def usage() -> dict | None:
    """Memory in use now, and the most it has been since the server started, in MB. None where the system does not say (anything but Linux)."""
    try:
        with open("/proc/self/status", encoding="ascii") as status:
            fields = dict(line.split(":", 1) for line in status if ":" in line)
        return {"now_mb": round(int(fields["VmRSS"].split()[0]) / 1024), "peak_mb": round(int(fields["VmHWM"].split()[0]) / 1024)}
    except (OSError, KeyError, ValueError, IndexError):
        return None
