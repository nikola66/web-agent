import os, ctypes
os.environ["LD_PRELOAD"] = "/tmp/shim.so"
lib = ctypes.CDLL("/tmp/shim.so")
