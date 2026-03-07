/**
 * Main function to update Albi data from uploaded Excel file
 */
function updateFullAlbiData() {
  const html = HtmlService.createHtmlOutputFromFile('UploadSidebar')
    .setTitle('Upload Albi Data')
    .setWidth(350);
  
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Process the uploaded Excel file
 * Called from the sidebar
 */
/**
 * Process the uploaded Excel file and refresh phone links in the Calls tab.
 */

function processUploadedFile(base64Data, fileName) {
  try {
    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64Data),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName
    );
    
    const tempFile = DriveApp.createFile(blob);
    const resource = { title: 'temp_' + fileName, mimeType: MimeType.GOOGLE_SHEETS };
    const tempSheet = Drive.Files.copy(resource, tempFile.getId());
    const tempSpreadsheet = SpreadsheetApp.openById(tempSheet.id);
    const sourceData = tempSpreadsheet.getSheets()[0].getDataRange().getValues();
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const targetSheet = ss.getSheetByName('albidata');
    const callsSheet = ss.getSheetByName('Calls'); // Target the Calls tab
    
    if (!targetSheet) throw new Error('Sheet "albidata" not found');

    targetSheet.clear();
    
    if (sourceData.length > 0) {
      const numRows = sourceData.length;
      const numCols = sourceData[0].length;
      targetSheet.getRange(1, 1, numRows, numCols).setValues(sourceData);
      
      const headers = sourceData[0];
      const linkColumnIndex = headers.findIndex(h => h && h.toString().toLowerCase().includes('link to project'));
      
      if (linkColumnIndex !== -1) {
        const sourceSheet = tempSpreadsheet.getSheets()[0];
        const sourceRichText = sourceSheet.getRange(1, linkColumnIndex + 1, numRows, 1).getRichTextValues();
        targetSheet.getRange(1, linkColumnIndex + 1, numRows, 1).setRichTextValues(sourceRichText);
      }
    }

    // --- NEW LOGIC: Refresh Phone Links in Calls Tab (Column B) ---
    if (callsSheet) {
      const lastRowCalls = callsSheet.getLastRow();
      if (lastRowCalls > 1) {
        const phoneRange = callsSheet.getRange(2, 2, lastRowCalls - 1, 1); // Column B
        const phoneValues = phoneRange.getValues();
        const linkedRichText = phoneValues.map(row => {
          const rawPhone = row[0].toString();
          const cleanPhone = rawPhone.replace(/\D/g, ''); // Strip non-digits
          
          if (cleanPhone) {
            return [SpreadsheetApp.newRichTextValue()
              .setText(rawPhone)
              .setLinkUrl("tel:" + cleanPhone)
              .build()];
          }
          return [SpreadsheetApp.newRichTextValue().setText(rawPhone).build()];
        });
        phoneRange.setRichTextValues(linkedRichText);
      }
    }

    DriveApp.getFileById(tempFile.getId()).setTrashed(true);
    DriveApp.getFileById(tempSheet.id).setTrashed(true);
    
    return {
      success: true,
      message: `Import complete. albidata updated and Calls tab phone links refreshed.`,
      rowCount: sourceData.length
    };
    
  } catch (error) {
    return { success: false, message: 'Error: ' + error.message };
  }
}

/**
 * Trigger the masterSync function
 * Called from the sidebar after user confirms
 */
function runMasterSync() {
  try {
    // Call your existing masterSync function
    masterSync();
    return {
      success: true,
      message: 'Master sync completed successfully'
    };
  } catch (error) {
    return {
      success: false,
      message: 'Error running master sync: ' + error.message
    };
  }
}