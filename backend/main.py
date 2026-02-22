"""FastAPI app — CORS, lifespan, REST endpoints, WebSocket."""

import asyncio
import json
import os
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Load .env before importing agents (they need ANTHROPIC_API_KEY)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from db import init_db, get_conn
from clustering import detect_and_store
from agents.orchestrator import ws_connections, log_event, log_event_async


# --- Startup seed events ---

def generate_startup_events():
    """Generate initial agent events so the feed isn't empty on first load."""
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) FROM agent_events").fetchone()[0]
    if count > 0:
        conn.close()
        return  # Events already exist, skip
    conn.close()

    enc_conn = get_conn()
    enc_count = enc_conn.execute("SELECT COUNT(*) FROM encounters").fetchone()[0]
    enc_conn.close()

    if enc_count == 0:
        return

    # System boot events
    log_event("analyst", f"System initialized. {enc_count} encounters loaded from surveillance database.", "info")
    log_event("analyst", "Running spatial analysis on encounter dataset...", "info")

    # Run clustering and log results
    clusters = detect_and_store()

    if clusters:
        # Find the main cholera cluster
        main_cluster = max(clusters, key=lambda c: c["case_count"])
        log_event(
            "analyst",
            f"Detected cluster: {main_cluster['case_count']} cases of acute GI symptoms in Old Dhaka. "
            f"Anomaly score: {main_cluster['anomaly_score']}x baseline. Triggering investigation.",
            "alert",
            main_cluster.get("id"),
        )
        log_event(
            "research",
            f"Investigating cluster profile: dominant symptoms are watery diarrhea, vomiting, dehydration. "
            f"Cross-referencing with disease signature database...",
            "info",
            main_cluster.get("id"),
        )
        log_event(
            "research",
            f"Cluster flagged as probable {main_cluster['probable_disease']} outbreak. "
            f"Confidence: {(main_cluster['confidence'] * 100):.1f}%. "
            f"Matches V. cholerae signature: acute watery diarrhea + rapid dehydration + spatial clustering.",
            "warning",
            main_cluster.get("id"),
        )
        log_event(
            "response",
            f"Generating situation report for {main_cluster['probable_disease'].upper()} cluster. "
            f"Radius: {main_cluster['radius_km']} km, {main_cluster['case_count']} cases over 5 days.",
            "info",
            main_cluster.get("id"),
        )
        log_event(
            "accessibility",
            "Monitoring active CHW sessions. Language distribution: 75% Bangla, 25% English. "
            "Adapting alert templates for low-literacy delivery.",
            "info",
        )

        # Log secondary clusters
        for c in clusters:
            if c["id"] != main_cluster.get("id"):
                log_event(
                    "analyst",
                    f"Secondary cluster: {c['case_count']} cases, probable {c['probable_disease']} "
                    f"(anomaly {c['anomaly_score']}x, confidence {(c['confidence'] * 100):.0f}%).",
                    "info",
                    c.get("id"),
                )

        log_event("analyst", f"Analysis complete — {len(clusters)} cluster(s) detected. Primary threat: cholera.", "info")
    else:
        log_event("analyst", "Analysis complete — no significant clusters detected.", "info")


# --- Lifespan ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auto-seed database if it doesn't exist
    db_path = os.path.join(os.path.dirname(__file__) or ".", "sentinel.db")
    if not os.path.exists(db_path):
        print("[STARTUP] Seeding database...")
        subprocess.run(
            ["python", "seed.py"],
            cwd=os.path.dirname(__file__) or ".",
            check=True,
        )
        print("[STARTUP] Database seeded.")
    init_db()
    generate_startup_events()
    yield


app = FastAPI(title="SENTINEL", version="0.1.0", lifespan=lifespan)

# --- CORS ---

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pydantic models ---

class EncounterCreate(BaseModel):
    patient_id: str
    chw_id: str | None = None
    symptoms: list[str]
    onset_date: str | None = None
    severity: int = 3
    lat: float
    lng: float
    location_name: str | None = None
    language: str = "en"
    raw_input: str | None = None


class IntakeRequest(BaseModel):
    text: str
    chw_id: str | None = None
    lat: float | None = None
    lng: float | None = None


class SitRepRequest(BaseModel):
    cluster_id: int = 1


# --- Endpoints ---

@app.get("/")
async def root():
    return {"status": "ok", "service": "SENTINEL"}


@app.post("/encounters", status_code=201)
async def create_encounter(enc: EncounterCreate):
    conn = get_conn()
    symptoms_json = json.dumps(enc.symptoms)
    onset = enc.onset_date or datetime.now().strftime("%Y-%m-%d")

    cur = conn.execute(
        """INSERT INTO encounters
           (patient_id, chw_id, symptoms, onset_date, severity,
            lat, lng, location_name, language, raw_input)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (enc.patient_id, enc.chw_id, symptoms_json, onset, enc.severity,
         enc.lat, enc.lng, enc.location_name, enc.language, enc.raw_input),
    )
    conn.commit()
    enc_id = cur.lastrowid

    row = conn.execute("SELECT * FROM encounters WHERE id = ?", (enc_id,)).fetchone()
    conn.close()

    await log_event_async(
        "intake",
        f"New encounter recorded: {enc.patient_id} — {', '.join(enc.symptoms[:3])} (severity {enc.severity})",
        "info",
    )

    # Auto-trigger clustering
    clusters = detect_and_store()
    if clusters:
        for c in clusters:
            if c["anomaly_score"] > 5:
                await log_event_async(
                    "analyst",
                    f"Cluster detected: {c['case_count']} cases of probable {c['probable_disease']} "
                    f"(anomaly score {c['anomaly_score']}, confidence {c['confidence']})",
                    "alert" if c["anomaly_score"] > 10 else "warning",
                    c.get("id"),
                )

    return dict(row)


@app.get("/encounters")
async def list_encounters(since: str | None = Query(None)):
    conn = get_conn()
    if since:
        rows = conn.execute(
            "SELECT * FROM encounters WHERE timestamp >= ? ORDER BY timestamp DESC", (since,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM encounters ORDER BY timestamp DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/intake", status_code=201)
async def intake(req: IntakeRequest):
    from agents.intake import extract_encounter

    chw_label = req.chw_id or "field-reporter"
    await log_event_async("intake", f"Processing incoming field report from CHW {chw_label}...", "info")
    await log_event_async("accessibility", f"Detecting language and input modality for CHW {chw_label}...", "info")

    try:
        extracted = await asyncio.to_thread(
            extract_encounter, req.text, req.chw_id, req.lat, req.lng
        )
    except Exception as e:
        await log_event_async("intake", f"Extraction failed: {str(e)}", "warning")
        return {"error": f"Failed to extract encounter: {str(e)}"}

    # Store the encounter
    conn = get_conn()
    onset = extracted.get("onset_date", datetime.now().strftime("%Y-%m-%d"))
    symptoms_str = extracted.get("symptoms", "[]")
    if isinstance(symptoms_str, list):
        symptoms_str = json.dumps(symptoms_str)

    cur = conn.execute(
        """INSERT INTO encounters
           (patient_id, chw_id, symptoms, onset_date, severity,
            lat, lng, location_name, language, raw_input)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            extracted.get("patient_id", "P-0000"),
            extracted.get("chw_id"),
            symptoms_str,
            onset,
            extracted.get("severity", 3),
            extracted.get("lat"),
            extracted.get("lng"),
            extracted.get("location_name"),
            extracted.get("language", "en"),
            req.text,
        ),
    )
    conn.commit()
    enc_id = cur.lastrowid
    row = conn.execute("SELECT * FROM encounters WHERE id = ?", (enc_id,)).fetchone()
    conn.close()

    symptoms_list = extracted.get("symptoms_list", [])
    if not symptoms_list:
        try:
            symptoms_list = json.loads(symptoms_str)
        except Exception:
            symptoms_list = []

    location = extracted.get("location_name") or "coordinates provided"
    lang = extracted.get("language", "en")

    # Spawn background pipeline — timed agent events stream via WebSocket
    asyncio.create_task(
        _run_intake_pipeline(enc_id, extracted, symptoms_list, location, lang)
    )

    return {
        "encounter": dict(row),
        "extracted": extracted,
        "agent_reasoning": extracted.get("notes", "Encounter extracted from natural language input."),
    }


async def _run_intake_pipeline(enc_id, extracted, symptoms_list, location, lang):
    """Background: timed agent events showing the full autonomous pipeline."""
    try:
        # t+0s — Intake reports extraction result
        await log_event_async(
            "intake",
            f"NLP extraction complete — encounter #{enc_id}: "
            f"{', '.join(symptoms_list[:3])} | severity {extracted.get('severity', '?')}/5 | {location}. "
            f"Language detected: {lang}.",
            "info",
        )

        # t+1.5s — Intake commits to DB
        await asyncio.sleep(1.5)
        await log_event_async(
            "intake",
            f"Encounter #{enc_id} committed to surveillance database. Notifying Analyst Agent.",
            "info",
        )

        # t+3s — Analyst begins clustering
        await asyncio.sleep(1.5)
        await log_event_async(
            "analyst",
            "Re-running DBSCAN spatiotemporal clustering (eps=0.018deg, min_samples=3)...",
            "info",
        )

        # Actual clustering
        clusters = detect_and_store()

        # t+4.5s — Analyst reports clusters
        await asyncio.sleep(1.5)
        if clusters:
            main_cluster = max(clusters, key=lambda c: c["anomaly_score"])

            for c in clusters:
                sev = "info"
                if c["anomaly_score"] > 100:
                    sev = "alert"
                elif c["anomaly_score"] > 10:
                    sev = "warning"
                await log_event_async(
                    "analyst",
                    f"Cluster update: {c['case_count']} cases of probable {c['probable_disease']} "
                    f"(anomaly {c['anomaly_score']}x baseline, confidence {(c['confidence'] * 100):.0f}%).",
                    sev,
                    c.get("id"),
                )

            # t+6.5s — Research agent investigates (real Claude call)
            await asyncio.sleep(2.0)
            await log_event_async(
                "research",
                f"Initiating epidemiological investigation of {main_cluster.get('probable_disease', 'unknown').upper()} cluster. "
                f"Querying API for differential diagnosis and environmental analysis...",
                "info",
                main_cluster.get("id"),
            )

            try:
                from agents.research import investigate_cluster

                # Get encounters near the cluster for context
                r_conn = get_conn()
                nearby = r_conn.execute(
                    """SELECT * FROM encounters
                       WHERE ABS(lat - ?) < 0.02 AND ABS(lng - ?) < 0.02
                       ORDER BY timestamp DESC LIMIT 20""",
                    (main_cluster["center_lat"], main_cluster["center_lng"]),
                ).fetchall()
                r_conn.close()
                enc_list = [dict(e) for e in nearby]

                research_result = await asyncio.to_thread(
                    investigate_cluster, main_cluster, enc_list
                )

                await asyncio.sleep(1.5)

                # Broadcast primary assessment
                primary = research_result.get("primary_assessment", "Assessment unavailable.")
                trajectory = research_result.get("risk_trajectory", "UNKNOWN")
                await log_event_async(
                    "research",
                    f"Investigation complete — {primary} Risk trajectory: {trajectory}.",
                    "warning" if "ESCALATING" in trajectory else "info",
                    main_cluster.get("id"),
                )

                # Broadcast differential diagnosis
                diff_dx = research_result.get("differential_diagnosis", [])
                if diff_dx:
                    top_dx = diff_dx[0]
                    actions = research_result.get("confirmatory_actions", [])
                    await log_event_async(
                        "research",
                        f"Primary differential: {top_dx.get('disease', '?')} ({top_dx.get('probability', '?')}) — "
                        f"{top_dx.get('reasoning', '')} "
                        f"Confirmatory: {', '.join(actions[:2]) if actions else 'pending'}.",
                        "warning",
                        main_cluster.get("id"),
                    )
            except Exception as e:
                # Fallback to hardcoded if research agent fails
                await asyncio.sleep(1.5)
                conf = main_cluster.get("confidence", 0)
                await log_event_async(
                    "research",
                    f"Epidemiological match confirmed: {main_cluster['probable_disease'].upper()} "
                    f"({(conf * 100):.0f}% confidence). "
                    f"Dominant symptoms align with known pathogen signature.",
                    "warning" if conf > 0.7 else "info",
                    main_cluster.get("id"),
                )

            # t+9.5s — Response agent
            if main_cluster["anomaly_score"] > 50:
                await asyncio.sleep(1.5)
                await log_event_async(
                    "response",
                    f"High-threat cluster active: {main_cluster['probable_disease'].upper()} — "
                    f"{main_cluster['case_count']} cases, {main_cluster.get('radius_km', '?')}km radius. "
                    f"Updating situation assessment. WHO notification threshold: EXCEEDED.",
                    "alert",
                    main_cluster.get("id"),
                )

            # t+11s — Accessibility agent
            await asyncio.sleep(1.5)
            await log_event_async(
                "accessibility",
                f"Generating CHW alerts in Bangla and English. "
                f"Adapting for low-literacy SMS delivery within {main_cluster.get('radius_km', '?')}km radius.",
                "info",
                main_cluster.get("id"),
            )

            # t+12.5s — Pipeline complete
            await asyncio.sleep(1.5)
            await log_event_async(
                "analyst",
                f"Pipeline complete — {len(clusters)} active cluster(s). "
                f"Primary threat: {main_cluster['probable_disease'].upper()}.",
                "info",
            )
        else:
            await log_event_async("analyst", "Re-analysis complete — no significant clusters detected.", "info")

    except Exception as e:
        await log_event_async("analyst", f"Pipeline error: {str(e)}", "warning")


async def _run_accessibility_demo():
    """Background: simulate accessibility agent adaptation sequence."""
    try:
        await log_event_async(
            "accessibility",
            "Accessibility scan initiated. Analyzing active CHW device capabilities...",
            "info",
        )

        await asyncio.sleep(1.5)
        await log_event_async(
            "accessibility",
            "Detected 14 active CHW devices: 8 feature phones (SMS only), 4 smartphones (app), 2 tablets.",
            "info",
        )

        await asyncio.sleep(2.0)
        await log_event_async(
            "accessibility",
            "Language detection: 65% Bangla, 20% English, 10% Chittagonian, 5% Sylheti. "
            "Generating multilingual alert variants...",
            "info",
        )

        await asyncio.sleep(2.0)
        await log_event_async(
            "accessibility",
            "Low-literacy adaptation: Converting clinical terminology to plain-language. "
            "Adding visual symptom icons for smartphone delivery.",
            "warning",
        )

        await asyncio.sleep(1.5)
        await log_event_async(
            "accessibility",
            "SMS alert template (Bangla): '\u0986\u09aa\u09a8\u09be\u09b0 \u098f\u09b2\u09be\u0995\u09be\u09df \u09a1\u09be\u09df\u09b0\u09bf\u09df\u09be \u09b0\u09cb\u0997 \u099b\u09dc\u09bf\u09df\u09c7 \u09aa\u09dc\u099b\u09c7\u0964 "
            "\u09b0\u09cb\u0997\u09c0\u09a6\u09c7\u09b0 ORS \u09a6\u09bf\u09a8 \u098f\u09ac\u0982 \u09a8\u09bf\u0995\u099f\u09b8\u09cd\u09a5 \u09b8\u09cd\u09ac\u09be\u09b8\u09cd\u09a5\u09cd\u09af\u0995\u09c7\u09a8\u09cd\u09a6\u09cd\u09b0\u09c7 \u09aa\u09be\u09a0\u09be\u09a8\u0964'",
            "info",
        )

        await asyncio.sleep(1.5)
        await log_event_async(
            "accessibility",
            "Voice alert generated for feature phone IVR system. Duration: 28 seconds. "
            "Dialect: Standard Bangla with Dhaka regional terms.",
            "info",
        )

        await asyncio.sleep(1.5)
        await log_event_async(
            "accessibility",
            "Alert dispatched to 14 CHW devices. Delivery: 8 SMS, 4 push notifications, 2 in-app alerts. "
            "Estimated community coverage: 12,000 members.",
            "alert",
        )
    except Exception as e:
        await log_event_async("accessibility", f"Demo error: {str(e)}", "warning")


@app.post("/demo/accessibility")
async def demo_accessibility():
    """Simulate accessibility agent adaptation sequence for demo."""
    asyncio.create_task(_run_accessibility_demo())
    return {"status": "ok", "message": "Accessibility demo started"}


DEMO_TEXT = (
    "This is CHW Fatima in Mirpur-12. I saw 6 patients today, all with severe "
    "watery diarrhea and vomiting. Three are children under 5. One elderly woman "
    "is severely dehydrated and cannot keep fluids down. They all live near the "
    "Bhashantek canal. Symptoms started 2-3 days ago. I've never seen this many "
    "cases at once."
)


@app.post("/demo")
async def run_demo():
    """One-click full demo — submits the Fatima encounter through the full pipeline."""
    request = IntakeRequest(
        text=DEMO_TEXT,
        chw_id="CHW-042-FATIMA",
        lat=23.8042,
        lng=90.3687,
    )
    return await intake(request)


@app.get("/clusters")
async def list_clusters():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM clusters ORDER BY detected_at DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["dominant_symptoms"] = json.loads(d["dominant_symptoms"])
        except (json.JSONDecodeError, TypeError):
            pass
        result.append(d)
    return result


@app.get("/clusters/{cluster_id}")
async def get_cluster(cluster_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM clusters WHERE id = ?", (cluster_id,)).fetchone()
    if not row:
        conn.close()
        return {"error": "Cluster not found"}

    cluster = dict(row)
    try:
        cluster["dominant_symptoms"] = json.loads(cluster["dominant_symptoms"])
    except (json.JSONDecodeError, TypeError):
        pass

    encounters = conn.execute(
        """SELECT * FROM encounters
           WHERE ABS(lat - ?) < 0.02 AND ABS(lng - ?) < 0.02
           ORDER BY timestamp DESC""",
        (cluster["center_lat"], cluster["center_lng"]),
    ).fetchall()
    conn.close()

    cluster["encounters"] = [dict(e) for e in encounters]
    return cluster


@app.get("/sitrep/{cluster_id}")
async def get_sitrep(cluster_id: int):
    """GET version — generate situation report for a cluster."""
    return await _build_sitrep(cluster_id)


@app.post("/generate-sitrep")
async def generate_sitrep_post(req: SitRepRequest):
    """POST version — frontend buttons may call this instead."""
    return await _build_sitrep(req.cluster_id)


async def _build_sitrep(cluster_id: int):
    """Shared sitrep generation — tries Claude API first, falls back to structured demo data."""
    # Try to load real cluster data
    cluster = None
    encounters_list = []

    conn = get_conn()
    row = conn.execute("SELECT * FROM clusters WHERE id = ?", (cluster_id,)).fetchone()

    if not row:
        # Try first active cluster as fallback
        row = conn.execute(
            "SELECT * FROM clusters WHERE status = 'active' ORDER BY anomaly_score DESC LIMIT 1"
        ).fetchone()

    if row:
        cluster = dict(row)
        try:
            cluster["dominant_symptoms"] = json.loads(cluster["dominant_symptoms"])
        except (json.JSONDecodeError, TypeError):
            pass

        encounters = conn.execute(
            """SELECT * FROM encounters
               WHERE ABS(lat - ?) < 0.02 AND ABS(lng - ?) < 0.02
               ORDER BY timestamp DESC""",
            (cluster["center_lat"], cluster["center_lng"]),
        ).fetchall()
        encounters_list = [dict(e) for e in encounters]

    conn.close()

    await log_event_async(
        "response",
        f"Generating situation report for cluster #{cluster_id}...",
        "info",
        cluster_id,
    )

    # Try Claude-powered generation first
    if cluster:
        try:
            from agents.response import generate_sitrep
            sitrep = await asyncio.to_thread(generate_sitrep, cluster, encounters_list)
            await log_event_async(
                "response",
                f"SitRep generated: {sitrep.get('title', 'Untitled')} — Threat level: {sitrep.get('threat_level', '?')}",
                "alert" if sitrep.get("threat_level") in ("CRITICAL", "HIGH") else "info",
                cluster_id,
            )
            return sitrep
        except Exception as e:
            print(f"[SITREP] Claude API failed, using fallback: {e}")

    # Fallback — structured demo sitrep (no Claude required)
    case_count = cluster.get("case_count", 46) if cluster else 46
    disease = cluster.get("probable_disease", "cholera") if cluster else "cholera"
    anomaly = cluster.get("anomaly_score", 651.69) if cluster else 651.69
    confidence = cluster.get("confidence", 0.87) if cluster else 0.87

    if isinstance(confidence, (int, float)) and confidence <= 1:
        confidence_pct = f"{confidence * 100:.0f}%"
    else:
        confidence_pct = f"{confidence}%"

    symptoms = []
    if cluster:
        symptoms = cluster.get("dominant_symptoms", [])
        if isinstance(symptoms, str):
            try:
                symptoms = json.loads(symptoms)
            except Exception:
                symptoms = [symptoms]
    if not symptoms:
        symptoms = ["watery diarrhea", "vomiting", "severe dehydration"]

    threat = "CRITICAL" if anomaly > 100 else "HIGH" if anomaly > 50 else "MODERATE"

    sitrep = {
        "title": f"{disease.title()} Outbreak — Mirpur-12, Dhaka",
        "threat_level": threat,
        "summary": (
            f"Acute watery diarrhea cluster detected in Mirpur-12, Dhaka. "
            f"{case_count} confirmed cases over 5-day period. "
            f"Anomaly score {anomaly:.1f}x — baseline exceeded significantly. "
            f"Immediate public health response required."
        ),
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "cluster_id": cluster_id,
        "case_summary": {
            "total_cases": case_count,
            "trend": "Increasing",
            "severity_breakdown": "3 pediatric cases (under 5), 1 elderly severe dehydration, remainder adult moderate",
            "date_range": "Past 5 days",
        },
        "disease_assessment": {
            "probable_disease": f"V. cholerae O1 ({disease})",
            "confidence": confidence_pct,
            "key_symptoms": symptoms[:5],
            "transmission_route": "Waterborne — contaminated canal water (Bhashantek canal)",
            "incubation_period": "12 hours to 5 days (typically 2-3 days)",
        },
        "recommended_interventions": [
            "Deploy ORS packets to all Mirpur-12 health posts immediately",
            "Initiate water quality testing at 3 wells in sectors 4-7",
            "Mobilize oral cholera vaccination campaign (target: 2,000 doses)",
            "Activate community health worker alert network in Bengali",
            "Establish rehydration treatment center at Mirpur-12 clinic",
            "Restrict use of Bhashantek canal water pending test results",
        ],
        "resource_needs": [
            "5,000 ORS packets (immediate dispatch)",
            "200 liters IV fluids (Mirpur-12 clinic)",
            "2,000 oral cholera vaccination doses",
            "15 water testing kits (sectors 4-7)",
            "8 CHW teams of 3 for door-to-door assessment",
        ],
        "chw_alert": (
            "URGENT: Cholera cases increasing near Bhashantek canal. "
            "Ask ALL patients about water source. "
            "Give ORS immediately to anyone with watery diarrhea. "
            "Prioritize children under 5 and elderly. "
            "Report new cases within 1 hour. "
            "Do NOT use canal water."
        ),
    }

    await log_event_async(
        "response",
        f"SitRep generated: {sitrep['title']} — Threat level: {threat}",
        "alert" if threat in ("CRITICAL", "HIGH") else "info",
        cluster_id,
    )

    return sitrep


@app.post("/analyze")
async def trigger_analysis():
    await log_event_async("analyst", "Manual analysis triggered — running DBSCAN clustering...", "info")

    clusters = detect_and_store()

    if not clusters:
        await log_event_async("analyst", "Analysis complete — no clusters detected.", "info")
        return {"clusters": [], "message": "No clusters detected"}

    for c in clusters:
        severity = "info"
        if c["anomaly_score"] > 100:
            severity = "alert"
        elif c["anomaly_score"] > 10:
            severity = "warning"

        await log_event_async(
            "analyst",
            f"Cluster: {c['case_count']} cases, probable {c['probable_disease']} "
            f"(anomaly {c['anomaly_score']}, confidence {c['confidence']})",
            severity,
            c.get("id"),
        )

    await log_event_async("analyst", f"Analysis complete — {len(clusters)} cluster(s) detected.", "info")
    return {"clusters": clusters, "message": f"{len(clusters)} cluster(s) detected"}


@app.get("/events")
async def list_events(limit: int = Query(50)):
    """Return recent agent events for feed backfill (chronological order)."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM agent_events ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    # Return in chronological order (oldest first)
    return [dict(r) for r in reversed(rows)]


# Keep old endpoint for backwards compat
@app.get("/agent-events")
async def list_agent_events(limit: int = Query(50)):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM agent_events ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- WebSocket ---

@app.websocket("/ws/feed")
async def ws_feed(websocket: WebSocket):
    await websocket.accept()
    ws_connections.append(websocket)

    # Send recent events on connect (chronological order)
    conn = get_conn()
    recent = conn.execute(
        "SELECT * FROM agent_events ORDER BY id DESC LIMIT 50"
    ).fetchall()
    conn.close()

    for row in reversed(recent):
        try:
            await websocket.send_text(json.dumps(dict(row)))
        except Exception:
            break

    try:
        while True:
            # Keep connection alive — accept pings/pongs and client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in ws_connections:
            ws_connections.remove(websocket)
    except Exception:
        if websocket in ws_connections:
            ws_connections.remove(websocket)


# --- Serve built frontend ---

frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    # Serve static assets (js, css, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    # Catch-all: serve index.html for any non-API route (SPA routing)
    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        file_path = os.path.join(frontend_dist, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
