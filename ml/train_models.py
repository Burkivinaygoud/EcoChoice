from pathlib import Path
import re

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBRegressor

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "product_cleaned.csv"
MODEL_PATH = BASE_DIR / "models.joblib"

CATEGORY_COLUMN = "Company's GICS Industry"
PRODUCT_NAME_COLUMN = "Product name (and functional unit)"
WEIGHT_COLUMN = "Product weight (kg)"
TARGET_COLUMN = "Product's carbon footprint (PCF, kg CO2e)"


def infer_material(value):
    text = str(value).lower()
    keywords = [
        ("bamboo", "Bamboo"),
        ("cotton", "Cotton"),
        ("steel", "Steel"),
        ("aluminum", "Aluminum"),
        ("aluminium", "Aluminum"),
        ("wood", "Wood"),
        ("paper", "Paper"),
        ("cardboard", "Paper"),
        ("glass", "Glass"),
        ("plastic", "Plastic"),
        ("polyethylene", "Plastic"),
        ("polypropylene", "Plastic"),
        ("pvc", "Plastic"),
        ("rubber", "Rubber"),
        ("leather", "Leather"),
        ("ceramic", "Ceramic"),
    ]
    for keyword, material in keywords:
        if keyword in text:
            return material
    return "Unknown"


def infer_packaging(value):
    text = str(value).lower()
    keywords = [
        ("corrugated", "Corrugated cardboard"),
        ("cardboard", "Cardboard"),
        ("carton", "Cardboard"),
        ("box", "Cardboard"),
        ("bottle", "Bottle"),
        ("can", "Can"),
        ("pouch", "Pouch"),
        ("film", "Film"),
        ("bag", "Bag"),
        ("package", "Package"),
        ("packaging", "Package"),
    ]
    for keyword, packaging in keywords:
        if keyword in text:
            return packaging
    return "Unknown"


def normalize_category(value):
    text = re.sub(r"\s+", " ", str(value).strip())
    return text or "Unknown"


def build_features(frame):
    return pd.DataFrame({
        "category": frame["category"].map(normalize_category),
        "material": frame["material"].fillna("Unknown").map(normalize_category),
        "productWeight": frame["productWeight"].astype(float),
        "logProductWeight": np.log1p(frame["productWeight"].astype(float)),
        "packagingType": frame["packagingType"].fillna("Unknown").map(normalize_category),
    })


def create_pipeline(model):
    preprocess = ColumnTransformer(
        transformers=[
            ("categorical", OneHotEncoder(handle_unknown="ignore"), ["category", "material", "packagingType"]),
            ("numeric", "passthrough", ["productWeight", "logProductWeight"]),
        ]
    )
    return Pipeline([("preprocess", preprocess), ("model", model)])


def main():
    raw = pd.read_csv(DATA_PATH)
    frame = pd.DataFrame({
        "category": raw[CATEGORY_COLUMN],
        "productName": raw[PRODUCT_NAME_COLUMN],
        "productWeight": pd.to_numeric(raw[WEIGHT_COLUMN], errors="coerce"),
        "target": pd.to_numeric(raw[TARGET_COLUMN], errors="coerce"),
    }).dropna(subset=["category", "productWeight", "target"])
    frame = frame[(frame["productWeight"] > 0) & (frame["target"] >= 0)]
    frame["material"] = frame["productName"].map(infer_material)
    frame["packagingType"] = frame["productName"].map(infer_packaging)

    features = build_features(frame)
    # The source spans several orders of magnitude. Fitting log(1 + footprint)
    # prevents the largest industrial records from dominating consumer products.
    target = np.log1p(frame["target"])
    x_train, x_test, y_train, y_test = train_test_split(features, target, test_size=0.2, random_state=42)

    random_forest = create_pipeline(RandomForestRegressor(n_estimators=300, random_state=42, n_jobs=-1, min_samples_leaf=2))
    xgboost = create_pipeline(XGBRegressor(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.04,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=4,
    ))
    random_forest.fit(x_train, y_train)
    xgboost.fit(x_train, y_train)

    forest_predictions = np.expm1(random_forest.predict(x_test))
    boost_predictions = np.expm1(xgboost.predict(x_test))
    ensemble_predictions = (forest_predictions + boost_predictions) / 2
    actual_predictions = np.expm1(y_test.to_numpy())
    absolute_errors = np.abs(actual_predictions - ensemble_predictions)
    metrics = {
        "rows": int(len(frame)),
        "randomForestMae": float(mean_absolute_error(actual_predictions, forest_predictions)),
        "xgboostMae": float(mean_absolute_error(actual_predictions, boost_predictions)),
        "ensembleMae": float(mean_absolute_error(actual_predictions, ensemble_predictions)),
        "ensembleRmse": float(mean_squared_error(actual_predictions, ensemble_predictions) ** 0.5),
        "ensembleMedianAbsoluteError": float(np.median(absolute_errors)),
        "ensembleMedianAbsolutePercentageError": float(
            np.median(absolute_errors / np.maximum(actual_predictions, 1e-6))
        ),
        "target": "log1p product-level kg CO2e",
        "source": "Carbon Catalogue product_cleaned.csv",
        "split": "80/20 random split, random_state=42",
        "modelVersion": 2,
    }
    joblib.dump({"randomForest": random_forest, "xgboost": xgboost, "metrics": metrics}, MODEL_PATH)
    print(metrics)
    print(f"Saved {MODEL_PATH}")


if __name__ == "__main__":
    main()
