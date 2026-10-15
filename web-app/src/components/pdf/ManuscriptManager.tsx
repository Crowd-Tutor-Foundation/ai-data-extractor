import React, { useState } from 'react';
import {
  Upload,
  FileText,
  Trash2,
  Sparkles,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCw,
  Download,
  FolderOpen,
  RefreshCw,
  Archive,
  CheckCheck,
} from 'lucide-react';
import JSZip from 'jszip';
import { DocumentConversionResult, ConvertedPageResult } from '../../types';
import { PdfExtractor } from '../../services/pdfExtractor';
import { DocxBuilder } from '../../services/docxBuilder';
import { getManuscriptFile } from '../../services/storageService';

interface ManuscriptManagerProps {
  uploadedFiles: Array<{ name: string; size: number; type: 'pdf' | 'docx' }>;
  conversionResults: Record<string, DocumentConversionResult>;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (name: string) => void;
  onUpdateConversion: (name: string, result: DocumentConversionResult) => void;
  onOpenVerificationStudio: (name: string) => void;
  showStatus: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const ManuscriptManager: React.FC<ManuscriptManagerProps> = ({
  uploadedFiles,
  conversionResults,
  onAddFiles,
  onRemoveFile,
  onUpdateConversion,
  onOpenVerificationStudio,
  showStatus,
}) => {
  const [isProcessingAll, setIsProcessingAll] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<{ current: number; total: number; filename: string } | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.name.toLowerCase().endsWith('.docx')
    );
    if (files.length > 0) {
      onAddFiles(files);
      showStatus(`Added ${files.length} manuscript(s).`, 'success');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.name.toLowerCase().endsWith('.docx')
    );
    if (files.length > 0) {
      onAddFiles(files);
      showStatus(`Added ${files.length} manuscript(s).`, 'success');
    }
    e.target.value = '';
  };

  // Run Fast Tier 1 Spatial Conversion on all PDFs in batch
  const handleConvertAllPdfs = async () => {
    const pdfs = uploadedFiles.filter((f) => f.type === 'pdf');
    if (pdfs.length === 0) {
      showStatus('No PDF files found to convert.', 'info');
      return;
    }

    setIsProcessingAll(true);
    showStatus('Running Batch Spatial Multi-Column Extraction...', 'info');

    try {
      for (let i = 0; i < pdfs.length; i++) {
        const p = pdfs[i];
        setProcessingProgress({ current: i + 1, total: pdfs.length, filename: p.name });

        const entry = await getManuscriptFile(p.name);
        if (!entry) continue;

        const pdfDoc = await PdfExtractor.loadPdfDocument(entry.data);
        const totalPages = pdfDoc.numPages;
        const pages: ConvertedPageResult[] = [];

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const pageRes = await PdfExtractor.extractPageSpatial(pdfDoc, pageNum);
          pages.push(pageRes);
        }

        const docxBlob = await DocxBuilder.buildDocxBlob(pages);
        const hasAnomalies = pages.some((pg) => pg.healthReport?.needsGeminiFallback);

        onUpdateConversion(p.name, {
          filename: p.name,
          totalPages,
          pages,
          status: hasAnomalies ? 'needs_review' : 'completed',
          approved: false,
          flagged: false,
          docxBlob,
        });
      }

      showStatus(`Batch complete! Converted ${pdfs.length} PDF(s) with multi-column reading order.`, 'success');
    } catch (err: any) {
      showStatus(`Batch PDF conversion failed: ${err.message}`, 'error');
    } finally {
      setIsProcessingAll(false);
      setProcessingProgress(null);
    }
  };

  // Bulk ZIP Export of all converted Word DOCX manuscripts
  const handleExportAllZip = async () => {
    const convertedEntries = Object.values(conversionResults).filter((c) => c.docxBlob);
    const directDocx = uploadedFiles.filter((f) => f.type === 'docx');

    if (convertedEntries.length === 0 && directDocx.length === 0) {
      showStatus('No converted DOCX files available to package into ZIP.', 'warning');
      return;
    }

    setIsZipping(true);
    showStatus('Packaging all manuscripts into ZIP archive...', 'info');

    try {
      const zip = new JSZip();
      const folder = zip.folder('converted_manuscripts_docx');

      // Add all converted PDF -> DOCX blobs
      for (const conv of convertedEntries) {
        if (conv.docxBlob) {
          const docxName = conv.filename.replace(/\.pdf$/i, '.docx');
          folder?.file(docxName, conv.docxBlob);
        }
      }

      // Add direct DOCX files from IndexedDB
      for (const d of directDocx) {
        const fileData = await getManuscriptFile(d.name);
        if (fileData) {
          folder?.file(d.name, fileData.data);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manuscripts_docx_batch_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      showStatus(`Successfully exported ZIP containing ${convertedEntries.length + directDocx.length} manuscripts!`, 'success');
    } catch (err: any) {
      showStatus(`Failed to generate ZIP archive: ${err.message}`, 'error');
    } finally {
      setIsZipping(false);
    }
  };

  // Metric aggregates
  const totalConvertedCount = Object.values(conversionResults).filter((c) => c.docxBlob).length;
  const needsReviewCount = Object.values(conversionResults).filter((c) => c.status === 'needs_review').length;
  const cleanCount = Object.values(conversionResults).filter((c) => c.status === 'completed').length;
  const approvedCount = Object.values(conversionResults).filter((c) => c.approved).length;

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 bg-slate-950/60 hover:bg-slate-900/40 p-8 rounded-2xl text-center space-y-3 transition cursor-pointer"
      >
        <div className="p-3 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded-2xl w-fit mx-auto">
          <Upload className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-200">Drag & Drop Research Papers (PDF / DOCX)</h3>
          <p className="text-xs text-slate-400">
            Files are loaded securely in client-side browser memory and IndexedDB. Zero remote server transit.
          </p>
        </div>

        <label className="inline-block cursor-pointer px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm transition">
          <span>Browse Files</span>
          <input type="file" multiple accept=".pdf,.docx" onChange={handleFileInput} className="hidden" />
        </label>
      </div>

      {/* Progress Strip */}
      {processingProgress && (
        <div className="bg-slate-900 border border-indigo-500/40 p-3.5 rounded-xl space-y-2 animate-in fade-in shadow-lg">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-indigo-300 flex items-center space-x-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Converting {processingProgress.filename}...</span>
            </span>
            <span className="font-mono text-slate-400">
              {processingProgress.current} / {processingProgress.total} PDFs
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.round((processingProgress.current / processingProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Batch Metrics Summary Strip */}
      {uploadedFiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Uploads</span>
            <span className="text-lg font-bold text-slate-100 font-mono">{uploadedFiles.length}</span>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Clean Converted</span>
            <span className="text-lg font-bold text-emerald-300 font-mono">{cleanCount}</span>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Needs QC Review</span>
            <span className="text-lg font-bold text-amber-300 font-mono">{needsReviewCount}</span>
          </div>
          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">Human Approved</span>
            <span className="text-lg font-bold text-indigo-300 font-mono">{approvedCount}</span>
          </div>
        </div>
      )}

      {/* Manuscripts Table & Actions Toolbar */}
      {uploadedFiles.length > 0 && (
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/80 shadow-xl space-y-0">
          <div className="p-3.5 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <FolderOpen className="h-4 w-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Uploaded Manuscripts ({uploadedFiles.length})
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {/* Batch Export ZIP */}
              <button
                onClick={handleExportAllZip}
                disabled={isZipping || totalConvertedCount === 0}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg flex items-center space-x-1.5 transition disabled:opacity-40"
              >
                {isZipping ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5 text-amber-400" />}
                <span>Export All (.zip)</span>
              </button>

              {/* Batch Convert All PDFs */}
              <button
                onClick={handleConvertAllPdfs}
                disabled={isProcessingAll}
                className="px-3.5 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                {isProcessingAll ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span>Batch Convert All PDFs</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[480px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="p-3 w-8 text-center">#</th>
                  <th className="p-3">Manuscript Filename</th>
                  <th className="p-3 w-24">Type</th>
                  <th className="p-3 w-24">Size</th>
                  <th className="p-3 w-48">Conversion Status</th>
                  <th className="p-3 w-36 text-center">Verification</th>
                  <th className="p-3 w-16 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {uploadedFiles.map((file, idx) => {
                  const conv = conversionResults[file.name];
                  const hasAnomalies = conv?.pages.some((p) => p.healthReport?.needsGeminiFallback);

                  return (
                    <tr key={file.name} className="hover:bg-slate-900/50 transition">
                      <td className="p-3 text-center text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                      <td className="p-3 font-semibold text-slate-200 truncate max-w-xs">{file.name}</td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase border ${
                            file.type === 'pdf'
                              ? 'bg-rose-950 text-rose-300 border-rose-800'
                              : 'bg-blue-950 text-blue-300 border-blue-800'
                          }`}
                        >
                          {file.type}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400 font-mono text-[11px]">
                        {(file.size / 1024).toFixed(1)} KB
                      </td>
                      <td className="p-3">
                        {file.type === 'docx' ? (
                          <span className="text-[11px] text-emerald-400 flex items-center space-x-1 font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Direct DOCX Ready</span>
                          </span>
                        ) : conv ? (
                          <div className="space-y-0.5">
                            <span
                              className={`text-[11px] flex items-center space-x-1 font-semibold ${
                                conv.approved
                                  ? 'text-indigo-400'
                                  : hasAnomalies
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {conv.approved ? (
                                <CheckCheck className="h-3.5 w-3.5 text-indigo-400" />
                              ) : hasAnomalies ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              )}
                              <span>
                                {conv.approved
                                  ? 'Approved & Verified'
                                  : hasAnomalies
                                  ? 'Needs QC Review'
                                  : 'Spatial Converted'}
                              </span>
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              {conv.totalPages} Pages Extracted
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">Awaiting Conversion</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => onOpenVerificationStudio(file.name)}
                          className="px-2.5 py-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded-lg flex items-center space-x-1 mx-auto transition"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Review & Verify</span>
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => onRemoveFile(file.name)}
                          className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-rose-950/40 transition"
                          title="Remove Manuscript"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
