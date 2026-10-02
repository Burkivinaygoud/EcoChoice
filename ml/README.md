# Sustainability scoring model

The model uses the public Carbon Catalogue product-level dataset:

`https://github.com/samina265/pcf-quality-framework/tree/main/BEACON-PCF/data`

The training target is product carbon footprint in kg CO2e. The models use product category, material, packaging type, and product weight. The public rows provide category, product weight, and carbon footprint; material and packaging are inferred from product descriptions where possible and otherwise set to `Unknown`.

The saved ensemble averages a Random Forest and XGBoost prediction. The admin API expects product weight in grams and converts it to kilograms before prediction.

Retrain the models with:

```powershell
npm run train:model
```

This is an estimate, not a certified product life-cycle assessment. The API returns validation metrics and model agreement so low-confidence predictions can be reviewed.
