/**
 * DYNAMIC CONFIGURATION
 */
const BASE_CONFIG = {
  SHEET_NAME: 'Calls',
  CONFIG_SHEET_NAME: 'Config',
  DEFAULT_MODEL: 'gpt-4o-mini',
  AUDIO_MODEL: 'gpt-4o-audio-preview' 
};

function getSheetConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(BASE_CONFIG.CONFIG_SHEET_NAME);
  if (!configSheet) throw new Error(`Sheet "${BASE_CONFIG.CONFIG_SHEET_NAME}" not found.`);
  return {
    callRailApiKey: configSheet.getRange("B1").getValue(),
    callRailAccountId: configSheet.getRange("B2").getValue(),
    openAiApiKey: configSheet.getRange("B3").getValue(),
    salesTipsPrompt: configSheet.getRange("A6").getValue()
  };
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Call Analyzer')
      .addItem('Get New Calls (Standard)', 'processCallRailCalls')
      .addSeparator()
      .addItem('🚀 Deep Analyze Highlighted Row(s)', 'deepAnalyzeSelection')
      .addSeparator()
      .addItem('Update Albi Data to Link Calls to Albi Files', 'updateFullAlbiData')
      .addToUi();
}

/**
 * TIER 2: Deep Analysis for Highlighted Rows
 */
function deepAnalyzeSelection() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BASE_CONFIG.SHEET_NAME);
  const config = getSheetConfig();
  const range = sheet.getActiveRange();
  const startRow = range.getRow();
  const numRows = range.getNumRows();

  if (startRow < 2) {
    SpreadsheetApp.getUi().alert("Please select a call row (not the header).");
    return;
  }

  for (let i = 0; i < numRows; i++) {
    let currentRow = startRow + i;
    let callLink = sheet.getRange(currentRow, 3).getValue(); 
    let callIdMatch = callLink.match(/CAL[a-zA-Z0-9]+/);
    if (!callIdMatch) continue;
    let callId = callIdMatch[0];

    sheet.getRange(currentRow, 11).setValue("Listening...");
    SpreadsheetApp.flush();

    let callData = fetchSingleCallDetails(callId, config);
    if (!callData || !callData.recording) continue;

    let audioBlob = downloadAudio(callData.recording, callId, config);
    if (!audioBlob) continue;

    let aiAnalysis = analyzeAudioDirectly(audioBlob, config);

    // Explicit Mapping for Deep Analysis
    sheet.getRange(currentRow, 4).setValue(aiAnalysis.handlerName);        // Col D
    sheet.getRange(currentRow, 5).setValue(aiAnalysis.viableLead);         // Col E
    sheet.getRange(currentRow, 7).setValue(aiAnalysis.scheduled);          // Col G
    sheet.getRange(currentRow, 9).setValue(aiAnalysis.notes);              // Col I
    sheet.getRange(currentRow, 10).setValue(aiAnalysis.salesTips);         // Col J
    sheet.getRange(currentRow, 11).setValue(aiAnalysis.tonalFeedback);     // Col K
    sheet.getRange(currentRow, 12).setValue(aiAnalysis.talkTimeRatio);     // Col L
  }
}

/**
 * TIER 1: Standard Hourly Processing
 */
function processCallRailCalls() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BASE_CONFIG.SHEET_NAME);
  const config = getSheetConfig();
  const lastRow = sheet.getLastRow();
  let existingLinks = lastRow > 1 ? sheet.getRange(2, 3, lastRow - 1, 1).getValues().flat() : [];

  const calls = fetchCallsFromCallRail(config);
  const newCalls = calls.reverse(); 

  for (let i = 0; i < newCalls.length; i++) {
    let call = newCalls[i];
    let callLink = call.recording_player || `https://app.callrail.com/calls/${call.id}`;

    if (existingLinks.includes(callLink)) continue;
    if (call.duration < 60 || !call.recording) continue;

    let audioBlob = downloadAudio(call.recording, call.id, config);
    if (!audioBlob) continue;

    let transcript = transcribeWithWhisper(audioBlob, config);
    let aiAnalysis = analyzeWithOpenAI(transcript, config);

    // FIXED MAPPING: I = Notes, J = Sales Tips, K = Tone, L = TalkTime
    sheet.appendRow([
      formatDate(call.start_time),       // A
      call.customer_phone_number,        // B
      callLink,                          // C
      aiAnalysis.handlerName,            // D
      aiAnalysis.viableLead,             // E
      aiAnalysis.introduced,             // F
      aiAnalysis.scheduled,              // G
      aiAnalysis.cbRequested,            // H
      aiAnalysis.notes,                  // I
      aiAnalysis.salesTips,              // J
      "Standard (Use Deep Analysis for Tone)", // K
      "N/A"                              // L
    ]);
    Utilities.sleep(1500); 
  }
}

/**
 * Audio-to-Analysis (Consolidated Step)
 */
function analyzeAudioDirectly(audioBlob, config) {
  const base64Audio = Utilities.base64Encode(audioBlob.getBytes());
  const salesTipsInstructions = config.salesTipsPrompt || "Provide general sales tips.";

  const payload = {
    "model": BASE_CONFIG.AUDIO_MODEL,
    "modalities": ["text"],
    "messages": [
      {
        "role": "system", 
        "content": `You are a Sales Call Analyst for a Restoration company. Analyze the audio and identify what the call handler could have done (if anything) to improve service or close lead. Return VALID JSON ONLY. No markdown.
                    Fields: handlerName, viableLead, introduced, scheduled, cbRequested, notes, salesTips: ${salesTipsInstructions}, 
                    tonalFeedback, talkTimeRatio (e.g. Agent 40% / Caller 60%)`
      },
      {
        "role": "user",
        "content": [{ "type": "input_audio", "input_audio": { "data": base64Audio, "format": "mp3" } }]
      }
    ]
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    'method': 'post', 'contentType': 'application/json',
    'headers': { 'Authorization': 'Bearer ' + config.openAiApiKey },
    'payload': JSON.stringify(payload), 'muteHttpExceptions': true
  });

  const resultText = JSON.parse(response.getContentText()).choices[0].message.content;
  const cleanJson = resultText.replace(/```json|```/g, "").trim();
  
  try {
    return JSON.parse(cleanJson);
  } catch (e) {
    return { notes: "AI parsing error", tonalFeedback: "Error", talkTimeRatio: "Error" };
  }
}

// --- CORE UTILITIES ---

function fetchSingleCallDetails(callId, config) {
  const url = `https://api.callrail.com/v3/a/${config.callRailAccountId}/calls/${callId}.json`;
  const res = UrlFetchApp.fetch(url, { 'headers': { 'Authorization': 'Token token=' + config.callRailApiKey } });
  return JSON.parse(res.getContentText());
}

function fetchCallsFromCallRail(config) {
  // Correct URL with start_date if needed, but date_range=recent is usually best for hourly runs
  const url = `https://api.callrail.com/v3/a/${config.callRailAccountId}/calls.json?date_range=recent&sort=start_time&order=desc&per_page=50`;
  
  const options = {
    'method': 'get',
    'headers': { 'Authorization': 'Token token=' + config.callRailApiKey }, // FIXED: Changed AccountId back to ApiKey
    'muteHttpExceptions': true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (json.error || response.getResponseCode() !== 200) {
      console.error("CallRail API Error: " + response.getContentText());
      return [];
    }
    
    return json.calls || [];
  } catch (e) {
    console.error('Error fetching list: ' + e.toString());
    return [];
  }
}

function downloadAudio(audioUrl, callId, config) {
  let currentUrl = audioUrl;
  let forceNoAuth = false;
  for (let i = 0; i < 5; i++) {
    let isStorage = currentUrl.includes("amazonaws.com") || currentUrl.includes("googleusercontent.com");
    let options = { 'headers': {}, 'followRedirects': false, 'muteHttpExceptions': true };
    if (!forceNoAuth && !isStorage) options.headers['Authorization'] = 'Token token=' + config.callRailApiKey;
    let res = UrlFetchApp.fetch(currentUrl, options);
    let code = res.getResponseCode();
    if (code === 301 || code === 302 || code === 307) {
      currentUrl = res.getHeaders()['Location'] || res.getHeaders()['location'];
      if (!currentUrl.includes("callrail")) forceNoAuth = true;
      continue;
    }
    if (code === 200) {
      if (res.getHeaders()['Content-Type'].includes("json")) {
        currentUrl = JSON.parse(res.getContentText()).url;
        forceNoAuth = true;
        continue;
      }
      return res.getBlob();
    }
  }
  return null;
}

function transcribeWithWhisper(blob, config) {
  blob.setName("recording.mp3");
  const options = {
    'method': 'post', 'headers': { 'Authorization': 'Bearer ' + config.openAiApiKey },
    'payload': { "file": blob, "model": "whisper-1", "response_format": "text" }
  };
  return UrlFetchApp.fetch('https://api.openai.com/v1/audio/transcriptions', options).getContentText();
}

function analyzeWithOpenAI(transcript, config) {
  // Ensure the prompt is a string and not an object/array
  const salesTipsInstructions = String(config.salesTipsPrompt);

  const payload = {
    "model": BASE_CONFIG.DEFAULT_MODEL, 
    "response_format": { "type": "json_object" },
    "messages": [
      { 
        "role": "system", 
        "content": `You are a Sales Call Analyst for a Restoration company. Analyze the transcript.
                    Return a JSON object with these fields: 
                    handlerName, viableLead, introduced, scheduled, cbRequested, notes, 
                    salesTips: Provide a single text block answering these points (make a numbered list and provide these answers in the order listed as numbered below): ${salesTipsInstructions}` 
      },
      { "role": "user", "content": transcript }
    ]
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': { 'Authorization': 'Bearer ' + config.openAiApiKey },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    const responseData = JSON.parse(res.getContentText());
    
    if (responseData.error) {
      return { notes: "AI Error: " + responseData.error.message, salesTips: "N/A" };
    }
    
    // Parse the AI's JSON response
    let parsed = JSON.parse(responseData.choices[0].message.content);

    // --- FIX STARTS HERE ---
    // Loop through every key in the object. If the value is an array or object, 
    // turn it into a string so the Spreadsheet can display it.
    Object.keys(parsed).forEach(key => {
      if (typeof parsed[key] === 'object' && parsed[key] !== null) {
        parsed[key] = Array.isArray(parsed[key]) ? parsed[key].join("\n") : JSON.stringify(parsed[key]);
      }
    });
    // --- FIX ENDS HERE ---

    return parsed;

  } catch (e) {
    console.error("Standard Analysis Error: " + e.toString());
    return {
      handlerName: "Error", viableLead: "Error", introduced: "Error", 
      scheduled: "Error", cbRequested: "Error", notes: "Analysis Failed", salesTips: "Error"
    };
  }
}
function formatDate(isoString) {
  return isoString ? Utilities.formatDate(new Date(isoString), Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm") : "";
}