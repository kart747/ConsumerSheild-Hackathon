#!/usr/bin/env python3
"""
train.py - Fine-tuning RoBERTa for Dark Pattern Detection
Dataset: aruneshmathur/dark-patterns (Princeton CSCW 2019)
Hardware: RTX 4050/5060 class GPUs
"""

import pandas as pd
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
    Trainer,
    TrainingArguments
)
from peft import LoraConfig, get_peft_model, TaskType
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, precision_recall_curve
from sklearn.utils.class_weight import compute_class_weight
import warnings
import json
import os

warnings.filterwarnings('ignore')

print("=" * 60)
print("ConsumerShield - Dark Pattern Model Fine-Tuning")
print("=" * 60)

# ============================================
# CONFIGURATION
# ============================================
MODEL_NAME = "roberta-base"
DATASET_URL = "https://raw.githubusercontent.com/aruneshmathur/dark-patterns/master/data/final-dark-patterns/dark-patterns.csv"
OUTPUT_DIR = "./consumershield-roberta-base-final"

BATCH_SIZE = 8
EPOCHS = 5
LEARNING_RATE = 2e-4 
MAX_LENGTH = 128
FP16 = True
SEED = 42
WEIGHT_DECAY = 0.01
WARMUP_RATIO = 0.1
EARLY_STOPPING_PATIENCE = 3

LORA_R = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.1
LORA_TARGET_MODULES = ["query", "value"]

np.random.seed(SEED)
torch.manual_seed(SEED)

# ============================================
# STEP 1: LOAD AND EXPLORE DATASET
# ============================================
print("\n" + "=" * 60)
print("STEP 1: Loading and exploring dataset...")
print("=" * 60)

df = pd.read_csv(DATASET_URL)

print(f"\nDataset shape: {df.shape}")
print(f"\nColumns: {df.columns.tolist()}")
print(f"\nFirst 5 rows:")
print(df.head())

print(f"\nPattern Category distribution:")
print(df['Pattern Category'].value_counts())

# ============================================
# STEP 2: PREPROCESSING
# ============================================
print("\n" + "=" * 60)
print("STEP 2: Preprocessing...")
print("=" * 60)

# Create label mapping from Pattern Category
unique_categories = sorted(df['Pattern Category'].dropna().unique().tolist())
label_map = {cat: idx for idx, cat in enumerate(unique_categories)}
print(f"\nLabel mapping ({len(label_map)} classes):")
for k, v in label_map.items():
    print(f"  {v}: {k}")

# Map labels
df = df.dropna(subset=['Pattern String', 'Pattern Category'])
df['text'] = df['Pattern String'].astype(str).str.strip()
df['label'] = df['Pattern Category'].map(label_map)
df = df.dropna(subset=['label'])
df['label'] = df['label'].astype(int)

# Handle class imbalance - compute weights
class_weights = compute_class_weight(
    class_weight='balanced',
    classes=np.unique(df['label'].values),
    y=df['label'].values
)
class_weights = torch.tensor(class_weights, dtype=torch.float32)
print(f"\nClass weights: {class_weights.tolist()}")

# ============================================
# STEP 3: TRAIN/TEST SPLIT
# ============================================
print("\n" + "=" * 60)
print("STEP 3: Splitting data (80/20, seed=42)...")
print("=" * 60)

train_texts, test_texts, train_labels, test_labels = train_test_split(
    df['text'].tolist(),
    df['label'].tolist(),
    test_size=0.2,
    random_state=SEED,
    stratify=df['label']
)

print(f"Train size: {len(train_texts)}")
print(f"Test size: {len(test_texts)}")

# ============================================
# STEP 4: DATASET & DATALOADER
# ============================================
print("\n" + "=" * 60)
print("STEP 4: Creating datasets...")
print("=" * 60)

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

class DarkPatternDataset(Dataset):
    def __init__(self, texts, labels):
        self.texts = texts
        self.labels = labels
    
    def __len__(self):
        return len(self.texts)
    
    def __getitem__(self, idx):
        encoding = tokenizer(
            self.texts[idx],
            truncation=True,
            padding='max_length',
            max_length=MAX_LENGTH,
            return_tensors='pt'
        )
        return {
            'input_ids': encoding['input_ids'].squeeze(),
            'attention_mask': encoding['attention_mask'].squeeze(),
            'labels': torch.tensor(self.labels[idx], dtype=torch.long)
        }

train_dataset = DarkPatternDataset(train_texts, train_labels)
test_dataset = DarkPatternDataset(test_texts, test_labels)

train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True)
test_loader = DataLoader(test_dataset, batch_size=BATCH_SIZE, shuffle=False)

print(f"Train batches: {len(train_loader)}")
print(f"Test batches: {len(test_loader)}")

# ============================================
# STEP 5: MODEL SETUP WITH LORA
# ============================================
print("\n" + "=" * 60)
print("STEP 5: Setting up model with LoRA...")
print("=" * 60)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

if device.type == 'cuda':
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")

model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=len(label_map)
)
model = model.to(device)

# Apply LoRA
lora_config = LoraConfig(
    r=LORA_R,
    lora_alpha=LORA_ALPHA,
    lora_dropout=LORA_DROPOUT,
    target_modules=LORA_TARGET_MODULES,
    task_type=TaskType.SEQ_CLS,
    bias="none",
    inference_mode=False
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# ============================================
# STEP 6: TRAINING
# ============================================
print("\n" + "=" * 60)
print("STEP 6: Training...")
print("=" * 60)

optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
total_steps = len(train_loader) * EPOCHS
num_warmup_steps = int(total_steps * WARMUP_RATIO)
scheduler = get_linear_schedule_with_warmup(
    optimizer,
    num_warmup_steps=num_warmup_steps,
    num_training_steps=total_steps
)

criterion = nn.CrossEntropyLoss(weight=class_weights.to(device))

scaler = torch.cuda.amp.GradScaler() if FP16 and device.type == 'cuda' else None

best_f1 = 0
best_model_state = None
patience_counter = 0

for epoch in range(EPOCHS):
    model.train()
    total_loss = 0
    
    for batch_idx, batch in enumerate(train_loader):
        input_ids = batch['input_ids'].to(device)
        attention_mask = batch['attention_mask'].to(device)
        labels = batch['labels'].to(device)
        
        optimizer.zero_grad()
        
        if scaler:
            with torch.cuda.amp.autocast():
                outputs = model(input_ids=input_ids, attention_mask=attention_mask)
                loss = criterion(outputs.logits, labels)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            loss = criterion(outputs.logits, labels)
            loss.backward()
            optimizer.step()
        
        total_loss += loss.item()
        scheduler.step()
        
        if (batch_idx + 1) % 50 == 0:
            print(f"  Epoch {epoch+1}/{EPOCHS}, Batch {batch_idx+1}/{len(train_loader)}, Loss: {loss.item():.4f}")
    
    avg_loss = total_loss / len(train_loader)
    print(f"Epoch {epoch+1}/{EPOCHS} - Loss: {avg_loss:.4f}")
    
    # ============================================
    # STEP 7: EVALUATION PER EPOCH
    # ============================================
    print(f"\nEvaluating epoch {epoch+1}/{EPOCHS}...")
    model.eval()
    all_preds = []
    all_labels = []
    all_probs = []
    
    with torch.no_grad():
        for batch in test_loader:
            input_ids = batch['input_ids'].to(device)
            attention_mask = batch['attention_mask'].to(device)
            labels = batch['labels'].to(device)
            
            if scaler:
                with torch.cuda.amp.autocast():
                    outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            else:
                outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            
            probs = torch.softmax(outputs.logits, dim=1)
            preds = torch.argmax(probs, dim=1)
            
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())
            all_probs.extend(probs.cpu().numpy())
    
    # Classification report
    print("\nClassification Report:")
    target_names = list(label_map.keys())
    report = classification_report(
        all_labels, 
        all_preds, 
        target_names=target_names,
        digits=4,
        zero_division=0
    )
    print(report)
    
    # Calculate macro F1 for model selection
    from sklearn.metrics import f1_score
    macro_f1 = f1_score(all_labels, all_preds, average='macro', zero_division=0)
    print(f"Macro F1: {macro_f1:.4f}")
    
    # Save best model
    if macro_f1 > best_f1:
        best_f1 = macro_f1
        best_model_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        print(f"✓ New best model saved! F1: {best_f1:.4f}")
        patience_counter = 0
    else:
        patience_counter += 1
        if patience_counter >= EARLY_STOPPING_PATIENCE:
            print(f"Early stopping triggered. No improvement for {EARLY_STOPPING_PATIENCE} epochs.")
            break

# ============================================
# STEP 8: FINAL EVALUATION
# ============================================
print("\n" + "=" * 60)
print("STEP 8: Final evaluation on best model...")
print("=" * 60)

model.load_state_dict(best_model_state)
model.eval()
model.to(device)

all_preds = []
all_labels = []
all_probs = []

with torch.no_grad():
    for batch in test_loader:
        input_ids = batch['input_ids'].to(device)
        attention_mask = batch['attention_mask'].to(device)
        labels = batch['labels'].to(device)
        
        if scaler:
            with torch.cuda.amp.autocast():
                outputs = model(input_ids=input_ids, attention_mask=attention_mask)
        else:
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
        
        probs = torch.softmax(outputs.logits, dim=1)
        preds = torch.argmax(probs, dim=1)
        
        all_preds.extend(preds.cpu().numpy())
        all_labels.extend(labels.cpu().numpy())
        all_probs.extend(probs.cpu().numpy())

print("\n" + "=" * 60)
print("FINAL CLASSIFICATION REPORT")
print("=" * 60)
print(classification_report(
    all_labels, 
    all_preds, 
    target_names=list(label_map.keys()),
    digits=4
))

# ============================================
# NOTE: Binary Detection Strategy
# ============================================
# This model classifies dark patterns into 7 types.
# It has NO negative class (no "not_a_dark_pattern").
# For inference, use confidence thresholds instead:
# - If max(probabilities) < 0.70 → treat as uncertain/no pattern
# - If max(probabilities) >= 0.70 → use predicted class
# This handles binary detection at inference time.

# ============================================
# STEP 9: SAVE MODEL
# ============================================
print("\n" + "=" * 60)
print("STEP 10: Saving model...")
print("=" * 60)

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Save model and tokenizer
model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

# Save label mapping
with open(f"{OUTPUT_DIR}/label_map.json", 'w') as f:
    json.dump(label_map, f, indent=2)

# Save config info
config_info = {
    "model_name": MODEL_NAME,
    "lora_r": LORA_R,
    "lora_alpha": LORA_ALPHA,
    "batch_size": BATCH_SIZE,
    "epochs": EPOCHS,
    "max_length": MAX_LENGTH,
    "best_macro_f1": best_f1
}
with open(f"{OUTPUT_DIR}/config.json", 'w') as f:
    json.dump(config_info, f, indent=2)

print(f"\n{'=' * 60}")
print(f"✓ Model saved to: {OUTPUT_DIR}")
print(f"{'=' * 60}")
print(f"\nLabel mapping: {label_map}")
print(f"Best Macro F1: {best_f1:.4f}")