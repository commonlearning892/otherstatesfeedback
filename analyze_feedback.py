import json
import os
import re

import numpy as np
import pandas as pd


base_dir = os.path.dirname(__file__)


def _normalize_col(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def _discover_inputs():
    files = []
    for fname in os.listdir(base_dir):
        low = fname.lower()
        if not (low.endswith('.xlsx') or low.endswith('.csv')):
            continue
        if 'feedback_report' not in low:
            continue
        files.append(os.path.join(base_dir, fname))

    xlsx = [p for p in files if p.lower().endswith('.xlsx')]
    csv = [p for p in files if p.lower().endswith('.csv')]
    return xlsx if xlsx else csv


def _read_input(path: str) -> pd.DataFrame:
    if path.lower().endswith('.xlsx'):
        return pd.read_excel(path)
    return pd.read_csv(path)


def _resolve_column(df: pd.DataFrame, candidates):
    cols = list(df.columns)
    norm_to_actual = { _normalize_col(c): c for c in cols }
    for c in candidates:
        if c in cols:
            return c
        n = _normalize_col(c)
        if n in norm_to_actual:
            return norm_to_actual[n]

    # fuzzy contains match
    for cand in candidates:
        n = _normalize_col(cand)
        for col in cols:
            if n and n in _normalize_col(col):
                return col

    return candidates[0]


def _rating_base(value) -> str:
    if pd.isna(value):
        return ''
    s = str(value).strip()
    if '[' in s:
        s = s.split('[', 1)[0].strip()
    s = s.replace('_', ' ')
    return s


def canonicalize_rating(value):
    s = _rating_base(value)
    if not s:
        return None

    low = s.strip().lower()
    low = low.replace('-', ' ')
    low = re.sub(r"\s+", " ", low)

    if 'not applicable' in low or low in ('na', 'n/a', 'n.a'):
        return 'Not Applicable'
    if 'excellent' in low:
        return 'Excellent'
    if low == 'very good':
        return 'Excellent'
    if 'good' in low:
        return 'Good'
    if 'average' in low or 'satisfactory' in low:
        return 'Average'
    if 'poor' in low or 'needs' in low or 'need' in low or 'improve' in low:
        return 'Poor'

    try:
        n = int(float(str(low).strip()))
        if n == 5:
            return 'Excellent'
        if n == 4:
            return 'Good'
        if n == 3:
            return 'Average'
        if n in (1, 2):
            return 'Poor'
    except Exception:
        pass

    return None


def numeric_rating(value):
    cat = canonicalize_rating(value)
    if cat == 'Excellent':
        return 5.0
    if cat == 'Good':
        return 4.0
    if cat == 'Average':
        return 3.0
    if cat == 'Poor':
        return 1.0
    return np.nan


def bucket_from_numeric_avg(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return 'Unanswered'
    try:
        num = float(v)
    except Exception:
        return 'Unanswered'
    if np.isnan(num):
        return 'Unanswered'
    r = int(round(num))
    if r >= 5:
        return 'Excellent'
    if r == 4:
        return 'Good'
    if r == 3:
        return 'Average'
    if r <= 2:
        return 'Poor'
    return 'Unanswered'


def bucket_counts_from_avg_series(series: pd.Series):
    counts = {'Excellent': 0, 'Good': 0, 'Average': 0, 'Poor': 0, 'Not Applicable': 0, 'Unanswered': 0}
    for v in series:
        b = bucket_from_numeric_avg(v)
        counts[b] = counts.get(b, 0) + 1
    return counts


def counts_from_series(series: pd.Series):
    counts = {'Excellent': 0, 'Good': 0, 'Average': 0, 'Poor': 0, 'Not Applicable': 0, 'Unanswered': 0}
    for v in series.values:
        if pd.isna(v) or str(v).strip() == '':
            counts['Unanswered'] += 1
            continue
        cat = canonicalize_rating(v)
        if cat is None:
            counts['Unanswered'] += 1
        else:
            counts[cat] = counts.get(cat, 0) + 1
    return counts


def avg_from_counts(counts):
    exc = counts.get('Excellent', 0)
    good = counts.get('Good', 0)
    avg = counts.get('Average', 0)
    poor = counts.get('Poor', 0)
    denom = exc + good + avg + poor
    if denom <= 0:
        return None
    return (5 * exc + 4 * good + 3 * avg + 1 * poor) / denom


def perf_from_series(series: pd.Series):
    dist = counts_from_series(series)
    return {
        'average': avg_from_counts(dist),
        'rating_distribution': dist
    }


def subject_perf_for_df(df_subset: pd.DataFrame, subj_cols: dict):
    out = {}
    for name, col in subj_cols.items():
        if col not in df_subset.columns:
            continue
        out[name] = perf_from_series(df_subset[col])
    return out


def category_perf_for_df(df_subset: pd.DataFrame, cat_cols: dict):
    out = {}
    for group_name, items in cat_cols.items():
        group_out = {}
        for item_name, col in items.items():
            if col not in df_subset.columns:
                continue
            group_out[item_name] = perf_from_series(df_subset[col])
        if group_out:
            out[group_name] = group_out
    return out


def rowwise_mean_from_cols(df_subset: pd.DataFrame, cols):
    num_cols = []
    for col in cols:
        if col not in df_subset.columns:
            continue
        ncol = f"{col}__num"
        df_subset[ncol] = df_subset[col].apply(numeric_rating)
        num_cols.append(ncol)
    if not num_cols:
        return pd.Series([np.nan] * len(df_subset), index=df_subset.index)
    return df_subset[num_cols].mean(axis=1, skipna=True)


def build_subject_performance_by_filters(df_subset: pd.DataFrame, subj_cols: dict, class_col: str, orientation_col: str):
    by_class = {}
    by_orientation = {}
    by_pair = {}

    if class_col in df_subset.columns:
        for c, g in df_subset.groupby(class_col):
            if pd.isna(c) or str(c).strip() == '':
                continue
            by_class[str(c)] = subject_perf_for_df(g, subj_cols)

    if orientation_col in df_subset.columns:
        for o, g in df_subset.groupby(orientation_col):
            if pd.isna(o) or str(o).strip() == '':
                continue
            by_orientation[str(o)] = subject_perf_for_df(g, subj_cols)

    if class_col in df_subset.columns and orientation_col in df_subset.columns:
        for c, gc in df_subset.groupby(class_col):
            if pd.isna(c) or str(c).strip() == '':
                continue
            ckey = str(c)
            by_pair[ckey] = {}
            for o, g in gc.groupby(orientation_col):
                if pd.isna(o) or str(o).strip() == '':
                    continue
                by_pair[ckey][str(o)] = subject_perf_for_df(g, subj_cols)

    return {'class': by_class, 'orientation': by_orientation, 'pair': by_pair}


def main():
    inputs = _discover_inputs()
    if not inputs:
        raise SystemExit('No input files found (expected FEEDBACK_REPORT*.csv or .xlsx)')

    # Use the newest file by name (usually includes date)
    inputs.sort()
    path = inputs[-1]
    print('Using input:', os.path.basename(path))

    df = _read_input(path)
    df.columns = [str(c).strip() for c in df.columns]

    branch_col = _resolve_column(df, ['BRANCH', 'Branch'])
    state_col = _resolve_column(df, ['STATE', 'State'])
    class_col = _resolve_column(df, ['CLASS NAME', 'Class Name', 'CLASS', 'Class'])
    orientation_col = _resolve_column(df, ['ORIENTATION', 'Orientation'])

    # Add Segment column based on class
    def classify_segment(class_name):
        if pd.isna(class_name):
            return 'Unknown'
        cn = str(class_name).strip().upper()
        # Pre Primary: UKG, LKG, NURSERY, PRE-K, IK1, IK2
        if any(x in cn for x in ['UKG', 'LKG', 'NURSERY', 'PRE-K', 'IK1', 'IK2']):
            return 'Pre Primary'
        # Primary: 1st to 5th class
        if any(x in cn for x in ['1ST', '2ND', '3RD', '4TH', '5TH', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH']):
            return 'Primary'
        # High School: 6th to 10th class
        if any(x in cn for x in ['6TH', '7TH', '8TH', '9TH', '10TH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH']):
            return 'High School'
        return 'Unknown'
    
    df['Segment'] = df[class_col].apply(classify_segment) if class_col in df.columns else 'Unknown'

    # Canonicalize keys
    for c in (branch_col, state_col, class_col, orientation_col):
        if c in df.columns:
            df[c] = df[c].astype(str).fillna('').str.strip()
            df.loc[df[c].eq('nan'), c] = ''
            df.loc[df[c].eq('None'), c] = ''

    subj_cols = {
        'I Language': _resolve_column(df, ['LANGUAGE / LITERACY SKILLS (WITH COMMUNICATION)', 'LANGUAGE / LITERACY SKILLS']),
        'II Language': _resolve_column(df, ['SECOND LANGUAGE / TELUGU (WITH COMMUNICATION)', 'SECOND LANGUAGE']),
        'III Language': _resolve_column(df, ['THIRD LANGUAGE (WITH COMMUNICATION)', 'THIRD LANGUAGE']),
        'Mathematics': _resolve_column(df, ['MATHEMATICS / NUMERICAL SKILLS', 'MATHEMATICS']),
        'General Science': _resolve_column(df, ['GENERAL SCIENCE / EVS / AWARENESS', 'GENERAL SCIENCE']),
        'Physics': _resolve_column(df, ['PHYSICS']),
        'Chemistry': _resolve_column(df, ['CHEMISTRY']),
        'Biology': _resolve_column(df, ['BIOLOGY']),
        'Social Studies': _resolve_column(df, ['SOCIAL STUDIES']),
    }

    cat_cols = {
        'Environment Quality': {
            'School Environment': _resolve_column(df, ['SCHOOL ENVIRONMENT']),
        },
        'Infrastructure': {
            'Facilities Adequacy': _resolve_column(df, ['FACILITIES ADEQUACY']),
            'Hygiene & Cleanliness': _resolve_column(df, ['HYGIENE & CLEANLINESS', 'HYGIENE & CLEANLINESS']),
            'Hostel Facilities': _resolve_column(df, ['HOSTEL FACILITIES']),
        },
        'Parent-Teacher Interaction': {
            'Class Teacher': _resolve_column(df, ['CLASS TEACHER']),
            'PTM Quality': _resolve_column(df, ['PTM QUALITY', 'PTM']),
        },
        'Administrative Support': {
            'Principal': _resolve_column(df, ['PRINCIPAL']),
            'Vice Principal': _resolve_column(df, ['VICE PRINCIPAL']),
            'Reception': _resolve_column(df, ['RECEPTION']),
            'Accountant': _resolve_column(df, ['ACCOUNTANT']),
            'Dean': _resolve_column(df, ['DEAN']),
        },
    }

    # Program for Excellence columns
    prog_exc_cols = {
        'Staff Quality': _resolve_column(df, ['PROGRAM FOR EXCELLENCE - STAFF QUALITY']),
        'Duration & Frequency': _resolve_column(df, ['PROGRAM FOR EXCELLENCE - DURATION & FREQUENCY']),
        'Options Available': _resolve_column(df, ['PROGRAM FOR EXCELLENCE - OPTIONS AVAILABLE']),
    }

    # Overall Satisfaction columns
    overall_sat_cols = {
        'Academics': _resolve_column(df, ['OVERALL SATISFACTION - ACADEMICS']),
        'Administration': _resolve_column(df, ['OVERALL SATISFACTION - ADMINISTRATION']),
        'Transport': _resolve_column(df, ['OVERALL SATISFACTION - TRANSPORT']),
    }

    # Communication column
    comm_col = _resolve_column(df, ['COMMUNICATION EFFECTIVENESS'])

    # Row-wise averages for KPIs
    df['Subject_Avg'] = rowwise_mean_from_cols(df, list(subj_cols.values()))
    df['Environment_Avg'] = rowwise_mean_from_cols(df, list(cat_cols.get('Environment Quality', {}).values()))
    df['Infrastructure_Avg'] = rowwise_mean_from_cols(df, list(cat_cols.get('Infrastructure', {}).values()))
    df['Admin_Avg'] = rowwise_mean_from_cols(df, list(cat_cols.get('Administrative Support', {}).values()))

    overall_components = ['Subject_Avg', 'Environment_Avg', 'Infrastructure_Avg', 'Admin_Avg']
    df['Overall_Avg'] = df[overall_components].mean(axis=1, skipna=True)

    def mean_safe(series):
        try:
            v = float(series.mean(skipna=True))
            return v if not np.isnan(v) else None
        except Exception:
            return None

    # Derive recommendation from Overall Satisfaction columns (since CSV doesn't have recommendation field)
    def derive_recommendation(row):
        """Derive Yes/No/Maybe from overall satisfaction scores"""
        avg = row.get('Overall_Avg')
        if pd.isna(avg):
            return None
        # Excellent (4.5-5.0) -> Yes, Good (3.5-4.5) -> Maybe, Below 3.5 -> No
        if avg >= 4.5:
            return 'Yes'
        elif avg >= 3.5:
            return 'Maybe'
        else:
            return 'No'
    
    df['Recommendation'] = df.apply(derive_recommendation, axis=1)
    
    # Calculate recommendation distribution
    rec_counts = df['Recommendation'].value_counts().to_dict()
    rec_distribution = {
        'Yes': rec_counts.get('Yes', 0),
        'No': rec_counts.get('No', 0),
        'Maybe': rec_counts.get('Maybe', 0),
        'Not Applicable': 0
    }
    total_rec = rec_distribution['Yes'] + rec_distribution['No'] + rec_distribution['Maybe']
    yes_pct = (rec_distribution['Yes'] / total_rec * 100.0) if total_rec > 0 else None
    
    # Derive recommendation reasons from category performance
    from collections import Counter
    yes_reasons = Counter()
    no_reasons = Counter()
    maybe_reasons = Counter()
    
    for _, row in df.iterrows():
        rec = row.get('Recommendation')
        if pd.isna(rec):
            continue
        
        # Identify top 2 performing and bottom 2 performing categories
        categories = {
            'Academics': row.get('Subject_Avg'),
            'Infrastructure': row.get('Infrastructure_Avg'),
            'Environment': row.get('Environment_Avg'),
            'Administration': row.get('Admin_Avg')
        }
        
        # Filter out NaN values
        valid_cats = {k: v for k, v in categories.items() if not pd.isna(v)}
        if not valid_cats:
            continue
        
        # Sort by score
        sorted_cats = sorted(valid_cats.items(), key=lambda x: x[1], reverse=True)
        
        if rec == 'Yes':
            # For Yes: mention top performing categories
            for cat, score in sorted_cats[:2]:
                if score >= 4.0:
                    yes_reasons[f'Good {cat}'] += 1
        elif rec == 'No':
            # For No: mention bottom performing categories
            for cat, score in sorted_cats[-2:]:
                if score < 3.5:
                    no_reasons[f'Poor {cat}'] += 1
        elif rec == 'Maybe':
            # For Maybe: mixed reasons
            if sorted_cats:
                top_cat, top_score = sorted_cats[0]
                if top_score >= 4.0:
                    maybe_reasons[f'Good {top_cat}'] += 1
    
    # Format reasons for output
    def format_reasons(counter, total):
        if total == 0:
            return {'top': [], 'top_detail': [], 'total_reasons': 0}
        items = counter.most_common(5)
        return {
            'total_reasons': sum(counter.values()),
            'top': [[k, round(v*100.0/total, 1)] for k, v in items],
            'top_detail': [[k, int(v), round(v*100.0/total, 1)] for k, v in items]
        }
    
    rec_reasons = {
        'Yes': format_reasons(yes_reasons, rec_distribution['Yes']),
        'No': format_reasons(no_reasons, rec_distribution['No']),
        'Maybe': format_reasons(maybe_reasons, rec_distribution['Maybe'])
    }

    # Overall aggregates
    subject_perf = subject_perf_for_df(df, subj_cols)
    category_perf = category_perf_for_df(df, cat_cols)
    prog_exc_perf = subject_perf_for_df(df, prog_exc_cols)
    overall_sat_perf = subject_perf_for_df(df, overall_sat_cols)
    
    # Communication effectiveness
    comm_effectiveness = None
    if comm_col in df.columns:
        comm_effectiveness = perf_from_series(df[comm_col]).get('average')

    overall_rating_counts = {
        'Overall Satisfaction': bucket_counts_from_avg_series(df['Overall_Avg']),
        'Academics': bucket_counts_from_avg_series(df['Subject_Avg']),
        'Environment': bucket_counts_from_avg_series(df['Environment_Avg']),
        'Infrastructure': bucket_counts_from_avg_series(df['Infrastructure_Avg']),
        'Administration': bucket_counts_from_avg_series(df['Admin_Avg']),
    }

    summary = {
        'total_responses': int(len(df)),
        'branches': df[branch_col].replace('', 'Unknown').value_counts().to_dict() if branch_col in df.columns else {},
        'states': df[state_col].replace('', 'Unknown').value_counts().to_dict() if state_col in df.columns else {},
        'classes': df[class_col].replace('', 'Unknown').value_counts().to_dict() if class_col in df.columns else {},
        'orientations': df[orientation_col].replace('', 'Unknown').value_counts().to_dict() if orientation_col in df.columns else {},
        'overall_avg': mean_safe(df['Overall_Avg']),
        'category_scores': {
            'Academics': mean_safe(df['Subject_Avg']),
            'Environment': mean_safe(df['Environment_Avg']),
            'Infrastructure': mean_safe(df['Infrastructure_Avg']),
            'Administration': mean_safe(df['Admin_Avg']),
        }
    }

    # Branch (City) performance
    branch_performance = {}
    branch_subject_performance = {}
    branch_category_performance = {}
    overall_rating_counts_by_branch = {}
    branch_rating_counts = {}
    if branch_col in df.columns:
        for b, g in df.groupby(branch_col):
            key = str(b).strip() or 'Unknown'
            branch_performance[key] = {
                'count': int(len(g)),
                'subject_avg': mean_safe(g['Subject_Avg']),
                'environment_avg': mean_safe(g['Environment_Avg']),
                'infrastructure_avg': mean_safe(g['Infrastructure_Avg']),
                'admin_avg': mean_safe(g['Admin_Avg']),
                'overall_avg': mean_safe(g['Overall_Avg']),
            }
            branch_subject_performance[key] = subject_perf_for_df(g, subj_cols)
            branch_category_performance[key] = category_perf_for_df(g, cat_cols)
            overall_rating_counts_by_branch[key] = {
                'Overall Satisfaction': bucket_counts_from_avg_series(g['Overall_Avg']),
                'Academics': bucket_counts_from_avg_series(g['Subject_Avg']),
                'Environment': bucket_counts_from_avg_series(g['Environment_Avg']),
                'Infrastructure': bucket_counts_from_avg_series(g['Infrastructure_Avg']),
                'Administration': bucket_counts_from_avg_series(g['Admin_Avg']),
            }
            # Generate rating counts by category group for heatmap
            branch_rating_counts[key] = {
                'Subjects': bucket_counts_from_avg_series(g['Subject_Avg']),
                'Environment': bucket_counts_from_avg_series(g['Environment_Avg']),
                'Infrastructure': bucket_counts_from_avg_series(g['Infrastructure_Avg']),
                'Administrative Support': bucket_counts_from_avg_series(g['Admin_Avg']),
            }

    # State aggregates
    state_performance = {}
    state_subject_performance = {}
    state_category_performance = {}
    overall_rating_counts_by_state = {}
    state_summaries = {}
    state_to_branches = {}

    if state_col in df.columns:
        for st, g in df.groupby(state_col):
            skey = str(st).strip() or 'Unknown'
            state_performance[skey] = {
                'count': int(len(g)),
                'subject_avg': mean_safe(g['Subject_Avg']),
                'environment_avg': mean_safe(g['Environment_Avg']),
                'infrastructure_avg': mean_safe(g['Infrastructure_Avg']),
                'admin_avg': mean_safe(g['Admin_Avg']),
                'overall_avg': mean_safe(g['Overall_Avg']),
            }
            state_subject_performance[skey] = subject_perf_for_df(g, subj_cols)
            state_category_performance[skey] = category_perf_for_df(g, cat_cols)
            overall_rating_counts_by_state[skey] = {
                'Overall Satisfaction': bucket_counts_from_avg_series(g['Overall_Avg']),
                'Academics': bucket_counts_from_avg_series(g['Subject_Avg']),
                'Environment': bucket_counts_from_avg_series(g['Environment_Avg']),
                'Infrastructure': bucket_counts_from_avg_series(g['Infrastructure_Avg']),
                'Administration': bucket_counts_from_avg_series(g['Admin_Avg']),
            }
            state_summaries[skey] = {
                'total_responses': int(len(g)),
                'branches': g[branch_col].replace('', 'Unknown').value_counts().to_dict() if branch_col in g.columns else {},
                'classes': g[class_col].replace('', 'Unknown').value_counts().to_dict() if class_col in g.columns else {},
                'orientations': g[orientation_col].replace('', 'Unknown').value_counts().to_dict() if orientation_col in g.columns else {},
                'overall_avg': mean_safe(g['Overall_Avg']),
                'category_scores': {
                    'Academics': mean_safe(g['Subject_Avg']),
                    'Environment': mean_safe(g['Environment_Avg']),
                    'Infrastructure': mean_safe(g['Infrastructure_Avg']),
                    'Administration': mean_safe(g['Admin_Avg']),
                }
            }
            if branch_col in g.columns:
                brs = sorted([x for x in g[branch_col].dropna().astype(str).str.strip().unique() if x])
            else:
                brs = []
            state_to_branches[skey] = brs

    # Academic filters: subject_performance by class/orientation (overall + by state + by branch)
    subject_performance_by = build_subject_performance_by_filters(df, subj_cols, class_col, orientation_col)

    state_subject_performance_by = {}
    if state_col in df.columns:
        for st, g in df.groupby(state_col):
            skey = str(st).strip() or 'Unknown'
            state_subject_performance_by[skey] = build_subject_performance_by_filters(g, subj_cols, class_col, orientation_col)

    branch_subject_performance_by = {}
    if branch_col in df.columns:
        for b, g in df.groupby(branch_col):
            key = str(b).strip() or 'Unknown'
            branch_subject_performance_by[key] = build_subject_performance_by_filters(g, subj_cols, class_col, orientation_col)

    # Global per-segment subject-wise analysis
    segment_subject_perf = {}
    
    # Define which subjects are applicable for each segment
    segment_subjects = {
        'Pre Primary': ['I Language', 'II Language', 'Mathematics', 'General Science'],
        'Primary': ['I Language', 'II Language', 'III Language', 'Mathematics', 'General Science', 'Social Studies'],
        'High School': ['I Language', 'II Language', 'III Language', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Social Studies']
    }
    
    for seg, gseg in df.groupby('Segment'):
        if seg == 'Unknown':
            continue
        subd = {}
        applicable_subjects = segment_subjects.get(seg, [])
        for subject_name, subject_col in subj_cols.items():
            # Skip subjects not applicable to this segment
            if subject_name not in applicable_subjects:
                continue
            if subject_col not in gseg.columns:
                continue
            series = gseg[subject_col]
            perf = perf_from_series(series)
            if perf.get('average') is not None:
                subd[subject_name] = perf
        if subd:
            segment_subject_perf[seg] = subd

    # Per-branch, per-segment, subject-wise analysis
    branch_segment_subject_perf = {}
    if branch_col in df.columns:
        for branch, g_branch in df.groupby(branch_col):
            key = str(branch).strip() or 'Unknown'
            branch_segment_subject_perf[key] = {}
            for seg, gseg in g_branch.groupby('Segment'):
                if seg == 'Unknown':
                    continue
                subd = {}
                applicable_subjects = segment_subjects.get(seg, [])
                for subject_name, subject_col in subj_cols.items():
                    # Skip subjects not applicable to this segment
                    if subject_name not in applicable_subjects:
                        continue
                    if subject_col not in gseg.columns:
                        continue
                    series = gseg[subject_col]
                    perf = perf_from_series(series)
                    if perf.get('average') is not None:
                        subd[subject_name] = perf
                if subd:
                    branch_segment_subject_perf[key][seg] = subd

    # Per-branch, per-segment aggregates for side-by-side comparisons
    branch_segment_perf = {}
    branch_segment_recommendation_counts = {}
    branch_segment_recommendation_reasons = {}
    
    if branch_col in df.columns:
        for branch, g_branch in df.groupby(branch_col):
            key = str(branch).strip() or 'Unknown'
            branch_segment_perf[key] = {}
            branch_segment_recommendation_counts[key] = {}
            branch_segment_recommendation_reasons[key] = {}
            
            for seg, g in g_branch.groupby('Segment'):
                if seg == 'Unknown':
                    continue
                branch_segment_perf[key][seg] = {
                    'count': int(len(g)),
                    'subject_avg': mean_safe(g['Subject_Avg']),
                    'environment_avg': mean_safe(g['Environment_Avg']),
                    'infrastructure_avg': mean_safe(g['Infrastructure_Avg']),
                    'admin_avg': mean_safe(g['Admin_Avg']),
                    'overall_avg': mean_safe(g['Overall_Avg'])
                }
                
                # Calculate recommendation counts for this segment
                seg_rec_counts = g['Recommendation'].value_counts().to_dict()
                branch_segment_recommendation_counts[key][seg] = {
                    'Yes': seg_rec_counts.get('Yes', 0),
                    'No': seg_rec_counts.get('No', 0),
                    'Maybe': seg_rec_counts.get('Maybe', 0)
                }
                
                # Calculate recommendation reasons for this segment
                seg_yes_reasons = Counter()
                seg_no_reasons = Counter()
                seg_maybe_reasons = Counter()
                
                for _, row in g.iterrows():
                    rec = row.get('Recommendation')
                    if pd.isna(rec):
                        continue
                    
                    categories = {
                        'Academics': row.get('Subject_Avg'),
                        'Infrastructure': row.get('Infrastructure_Avg'),
                        'Environment': row.get('Environment_Avg'),
                        'Administration': row.get('Admin_Avg')
                    }
                    valid_cats = {k: v for k, v in categories.items() if not pd.isna(v)}
                    if not valid_cats:
                        continue
                    
                    sorted_cats = sorted(valid_cats.items(), key=lambda x: x[1], reverse=True)
                    
                    if rec == 'Yes':
                        for cat, score in sorted_cats[:2]:
                            if score >= 4.0:
                                seg_yes_reasons[f'Good {cat}'] += 1
                    elif rec == 'No':
                        for cat, score in sorted_cats[-2:]:
                            if score < 3.5:
                                seg_no_reasons[f'Poor {cat}'] += 1
                    elif rec == 'Maybe':
                        if sorted_cats:
                            top_cat, top_score = sorted_cats[0]
                            if top_score >= 4.0:
                                seg_maybe_reasons[f'Good {top_cat}'] += 1
                
                # Format reasons
                def format_seg_reasons(counter, total):
                    if total == 0:
                        return {'top': [], 'top_detail': [], 'total_reasons': 0}
                    items = counter.most_common(5)
                    return {
                        'total_reasons': sum(counter.values()),
                        'top': [[k, round(v*100.0/total, 1)] for k, v in items],
                        'top_detail': [[k, int(v), round(v*100.0/total, 1)] for k, v in items]
                    }
                
                seg_rec = branch_segment_recommendation_counts[key][seg]
                branch_segment_recommendation_reasons[key][seg] = {
                    'Yes': format_seg_reasons(seg_yes_reasons, seg_rec['Yes']),
                    'No': format_seg_reasons(seg_no_reasons, seg_rec['No']),
                    'Maybe': format_seg_reasons(seg_maybe_reasons, seg_rec['Maybe'])
                }

    stats = {
        'summary': summary,
        'subject_performance': subject_perf,
        'category_performance': category_perf,
        'overall_rating_counts': overall_rating_counts,

        # City/Branch level (used by existing dashboard)
        'branch_performance': branch_performance,
        'branch_subject_performance': branch_subject_performance,
        'branch_category_performance': branch_category_performance,
        'overall_rating_counts_by_branch': overall_rating_counts_by_branch,

        # State level (new)
        'state_performance': state_performance,
        'state_subject_performance': state_subject_performance,
        'state_category_performance': state_category_performance,
        'overall_rating_counts_by_state': overall_rating_counts_by_state,
        'state_summaries': state_summaries,
        'state_to_branches': state_to_branches,

        # Academics filters (new)
        'subject_performance_by': subject_performance_by,
        'state_subject_performance_by': state_subject_performance_by,
        'branch_subject_performance_by': branch_subject_performance_by,

        # Segment-based subject performance (Academic sections)
        'segment_subject_performance': segment_subject_perf,
        'branch_segment_subject_performance': branch_segment_subject_perf,
        'branch_segment_performance': branch_segment_perf,

        # Program for Excellence
        'program_excellence': prog_exc_perf,
        'program_excellence_by_branch': {},

        # Communication
        'communication_metrics': {'Communication Effectiveness': comm_effectiveness} if comm_effectiveness else {},
        'communication_metrics_detail': {'Communication Effectiveness': perf_from_series(df[comm_col])} if comm_col in df.columns else {},
        
        # Overall Satisfaction
        'overall_satisfaction': overall_sat_perf,

        # PTM from category
        'ptm_effectiveness': mean_safe(df[cat_cols['Parent-Teacher Interaction']['PTM Quality']]) if cat_cols['Parent-Teacher Interaction']['PTM Quality'] in df.columns else None,

        # Optional keys expected by dashboard.js (keep empty for missing data)
        'rankings': {
            'branches': [],
            'orientations': [],
            'classes': [],
            'subjects': [],
        },
        'recommendation': {'distribution': rec_distribution, 'yes_pct': yes_pct},
        'recommendation_reasons': rec_reasons,
        'environment_focus': {},
        'branch_rating_counts': branch_rating_counts,
        'branch_rating_counts_by': {'class': {}, 'orientation': {}, 'pair': {}},
        'branch_recommendation_counts': {},
        'branch_recommendation_counts_by': {'class': {}, 'orientation': {}, 'pair': {}},
        'branch_recommendation_pct': {},
        'branch_segment_recommendation_counts': branch_segment_recommendation_counts,
        'branch_segment_recommendation_reasons': branch_segment_recommendation_reasons,
        'concern_roles': {},
        'concern_resolution': {},
    }

    # Build rankings from branch/state performance to keep existing charts working
    try:
        ranked = sorted(branch_performance.items(), key=lambda kv: (kv[1].get('overall_avg') or 0), reverse=True)
        stats['rankings']['branches'] = [(k, v.get('overall_avg'), v.get('count')) for k, v in ranked if v.get('overall_avg') is not None]

        ranked_o = sorted(summary.get('orientations', {}).items(), key=lambda kv: kv[1], reverse=True)
        stats['rankings']['orientations'] = [(k, None, int(v)) for k, v in ranked_o]

        ranked_c = sorted(summary.get('classes', {}).items(), key=lambda kv: kv[1], reverse=True)
        stats['rankings']['classes'] = [(k, None, int(v)) for k, v in ranked_c]

        ranked_s = sorted(subject_perf.items(), key=lambda kv: (kv[1].get('average') or 0), reverse=True)
        stats['rankings']['subjects'] = [(k, v.get('average')) for k, v in ranked_s if v.get('average') is not None]
    except Exception:
        pass

    # Add Program for Excellence by branch
    if branch_col in df.columns:
        for b, g in df.groupby(branch_col):
            key = str(b).strip() or 'Unknown'
            stats['program_excellence_by_branch'][key] = subject_perf_for_df(g, prog_exc_cols)

    # Add Communication by branch
    comm_by_branch = {}
    if branch_col in df.columns and comm_col in df.columns:
        for b, g in df.groupby(branch_col):
            key = str(b).strip() or 'Unknown'
            comm_by_branch[key] = {'Communication Effectiveness': perf_from_series(g[comm_col])}
    stats['communication_metrics_detail_by_branch'] = comm_by_branch

    out_path = os.path.join(base_dir, 'feedback_stats.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print('Wrote:', out_path)


if __name__ == '__main__':
    main()
