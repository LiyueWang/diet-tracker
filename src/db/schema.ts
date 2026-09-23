// src/db/schema.ts
import Dexie, { Table } from 'dexie';

export interface Meal {
  id: string;
  date: string;                 // YYYY-MM-DD
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  time: string;                 // HH:mm
  rawText?: string;
  source: 'voice' | 'text';
  note?: string;
  createdAt: string;
  updatedAt: string;
  deleted: 0 | 1;
}

export interface FoodItem {
  id: string;
  mealId: string;
  name: string;
  weightG: number | null;
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
  dataSource: 'food_library' | 'ai_estimate' | 'manual';
  foodLibraryId?: string;
  aiConfidence?: number;
  itemType: 'food' | 'supplement';
  supplementPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FoodLibraryItem {
  id: string;
  name: string;
  aliases: string[];
  category?: string;
  perAmount: number;            // 默认 100
  perUnit: 'g';
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
  commonPortionDesc?: string;
  commonPortionG?: number;
  tags?: string[];
  updatedAt: string;
}

export interface NutritionPlan {
  id: string;
  name: string;
  targetKcal: number;
  targetProteinG: number;
  targetCarbG: number;
  targetFatG: number;
  active: 0 | 1;
  updatedAt: string;
}

export interface SupplementPlan {
  id: string;
  name: string;
  timing?: string;
  defaultAmountG: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
  note?: string;
  active: 0 | 1;
  updatedAt: string;
}

export interface Report {
  id: string;
  reportType: 'daily' | 'weekly';
  dateStart: string;
  dateEnd: string;
  content: unknown;             // 结构化汇总
  aiAnalysis?: string;
  aiSuggestions?: string[];
  generatedAt: string;
}

export interface Profile {
  id: 'me';
  heightCm?: number;
  birthDate?: string;
  sex?: 'male' | 'female';
  activityLevel?: string;
  goalType?: string;
  targetWeightKg?: number;
  tdee?: number;
  targetKcal?: number;
  targetProteinG?: number;
  targetCarbG?: number;
  targetFatG?: number;
  updatedAt: string;
}

class DietDB extends Dexie {
  meals!: Table<Meal, string>;
  foodItems!: Table<FoodItem, string>;
  foodLibrary!: Table<FoodLibraryItem, string>;
  nutritionPlans!: Table<NutritionPlan, string>;
  supplementPlans!: Table<SupplementPlan, string>;
  reports!: Table<Report, string>;
  profile!: Table<Profile, string>;

  constructor() {
    super('diet-tracker');
    this.version(1).stores({
      meals: 'id, date, mealType, updatedAt, deleted',
      foodItems: 'id, mealId, name, itemType, updatedAt',
      foodLibrary: 'id, name, *aliases, category, updatedAt',
      nutritionPlans: 'id, active, updatedAt',
      supplementPlans: 'id, active, updatedAt',
      reports: 'id, reportType, dateStart, dateEnd, generatedAt',
      profile: 'id, updatedAt',
    });
  }
}

export const db = new DietDB();