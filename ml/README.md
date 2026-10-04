# Sustainability scoring model

The model uses the public Carbon Catalogue product-level dataset:

`https://github.com/samina265/pcf-quality-framework/tree/main/BEACON-PCF/data`

The training target is product carbon footprint in kg CO2e. The models use product category, material, packaging type, and product weight. The public rows provide category, product weight, and carbon footprint; material and packaging are inferred from product descriptions where possible and otherwise set to `Unknown`.

The saved ensemble averages a Random Forest and XGBoost prediction. Both models fit
`log1p(product carbon footprint)` and use both the supplied weight and `log1p(weight)`;
this reduces the effect of the dataset's very large industrial outliers. The admin API
expects product weight in grams and converts it to kilograms before prediction.

Retrain the models with:

```powershell
npm run train:model
```

This is an estimate, not a certified product life-cycle assessment. The API returns validation metrics and model agreement so low-confidence predictions can be reviewed.

The Vercel runtime cannot spawn the Python process used by the local server, so it uses
the documented fallback estimate in `server/index.js`. For the trained model in
production, deploy the Node server with Python, pandas, scikit-learn, XGBoost, and the
tracked `ml/models.joblib` artifact available. Install the pinned Python dependencies
with `pip install -r ml/requirements.txt`.

Grade thresholds are A (<= 1 kg), B (<= 2 kg), C (<= 3.5 kg), D (<= 4.5 kg),
E (<= 5.5 kg), and F (> 5.5 kg). The prediction script accepts weight in kilograms;
the admin HTTP endpoint accepts grams and converts to kilograms.

Example local prediction inputs covering every grade:

| Grade | Item | Weight | Category | Material | Packaging | Expected CO2e |
| --- | --- | ---: | --- | --- | --- | ---: |
| A | Bamboo sample | 10 g | Food Products | Bamboo | None | 0.112 kg |
| B | Bamboo sample | 1,000 g | Food Products | Bamboo | None | 1.380 kg |
| C | Steel sample | 1,000 g | Food Products | Steel | None | 2.059 kg |
| D | Steel computer component | 500 g | Computers & Peripherals | Steel | None | 4.027 kg |
| E | Steel packaged sample | 1,070 g | Food Products | Steel | Cardboard | 5.031 kg |
| F | Bamboo sample | 2,000 g | Food Products | Bamboo | None | 35.584 kg |

These are regression estimates, not measured values. Re-run the prediction after each
model change because the output can change when the training artifact is rebuilt.
