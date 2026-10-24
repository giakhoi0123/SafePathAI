#!/usr/bin/env python3
"""
Official Export Script for Ultralytics YOLO26n to ONNX format.
Saves verified model weights to data/models/yolo26n.onnx.
Performs ONNX structural verification, shapes audit, and SHA-256 calculation.
"""

import hashlib
import json
import os
import shutil
import sys
import numpy as np

def main():
    from ultralytics import YOLO
    import onnx
    import onnxruntime as ort

    target_dir = os.path.abspath("data/models")
    os.makedirs(target_dir, exist_ok=True)
    target_onnx_path = os.path.join(target_dir, "yolo26n.onnx")

    print("[1/5] Loading official pretrained YOLO('yolo26n.pt')...")
    model = YOLO("yolo26n.pt")

    print("[2/5] Exporting YOLO26n to ONNX (imgsz=640, dynamic=False, opset=17)...")
    exported_path = model.export(
        format="onnx",
        imgsz=640,
        dynamic=False,
        opset=17,
        simplify=True,
    )
    print(f"Export returned path: {exported_path}")

    # Copy to data/models/yolo26n.onnx
    shutil.copyfile(exported_path, target_onnx_path)
    print(f"Copied ONNX model to target: {target_onnx_path}")

    print("[3/5] Validating ONNX structure with onnx.checker...")
    onnx_model = onnx.load(target_onnx_path)
    onnx.checker.check_model(onnx_model)
    print("ONNX model structure check PASSED!")

    print("[4/5] Inspecting ONNX input/output tensors via ONNX Runtime...")
    session = ort.InferenceSession(target_onnx_path)
    inputs = session.get_inputs()
    outputs = session.get_outputs()

    print(f"Inputs count: {len(inputs)}")
    for idx, inp in enumerate(inputs):
        print(f"  Input[{idx}]: name='{inp.name}', shape={inp.shape}, type='{inp.type}'")

    print(f"Outputs count: {len(outputs)}")
    for idx, out in enumerate(outputs):
        print(f"  Output[{idx}]: name='{out.name}', shape={out.shape}, type='{out.type}'")

    # Run dummy inference
    dummy_input = np.zeros((1, 3, 640, 640), dtype=np.float32)
    test_out = session.run([outputs[0].name], {inputs[0].name: dummy_input})[0]
    print(f"Dummy inference successful! Output shape: {test_out.shape}, dtype: {test_out.dtype}")

    print("[5/5] Calculating file size and SHA-256 hash...")
    file_size = os.path.getsize(target_onnx_path)
    hasher = hashlib.sha256()
    with open(target_onnx_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            hasher.update(chunk)
    sha256_hash = hasher.hexdigest()

    print("\n" + "=" * 60)
    print("YOLO26N ONNX EXPORT SUMMARY")
    print("=" * 60)
    print(f"File Path:    {target_onnx_path}")
    print(f"File Size:    {file_size} bytes ({file_size / (1024*1024):.2f} MB)")
    print(f"SHA-256:      {sha256_hash}")
    print(f"Input Name:   {inputs[0].name}")
    print(f"Input Shape:  {inputs[0].shape}")
    print(f"Output Name:  {outputs[0].name}")
    print(f"Output Shape: {outputs[0].shape}")
    print(f"Output Dtype: {outputs[0].type}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()

