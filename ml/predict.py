import json
import sys
from pathlib import Path

import joblib
import pandas as pd

MODEL_PATH = Path(__file__).resolve().parent / "models.joblib"


def main():
    payload = json.loads(sys.stdin.read())
    features = pd.DataFrame([{
        "category": str(payload.get("category") or "Unknown"),
        "material": str(payload.get("material") or "Unknown"),
        "productWeight": float(payload.get("productWeight") or 0),
        "packagingType": str(payload.get("packagingType") or "Unknown"),
    }])
    if features.iloc[0]["productWeight"] <= 0:
        raise ValueError("productWeight must be greater than zero")

    bundle = joblib.load(MODEL_PATH)
    product_weight = float(features.iloc[0]["productWeight"])
    forest_value = max(0, float(bundle["randomForest"].predict(features)[0]) * product_weight)
    boost_value = max(0, float(bundle["xgboost"].predict(features)[0]) * product_weight)
    estimated_value = (forest_value + boost_value) / 2
    disagreement = abs(forest_value - boost_value) / max(estimated_value, 1)
    confidence = max(0.05, min(0.95, 0.95 - disagreement * 0.5))
    grade = "A" if estimated_value <= 1 else "B" if estimated_value <= 2 else "C" if estimated_value <= 3.5 else "D" if estimated_value <= 4.5 else "E" if estimated_value <= 5.5 else "F"

    print(json.dumps({
        "estimatedCo2": round(estimated_value, 3),
        "grade": grade,
        "confidence": round(confidence, 3),
        "randomForestCo2": round(forest_value, 3),
        "xgboostCo2": round(boost_value, 3),
        "validation": bundle["metrics"],
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
