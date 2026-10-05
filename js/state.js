/* state.js - Global constants, DOM references and application state shared by every other script. */
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
const SVGNS = "http://www.w3.org/2000/svg";
const $ = id => document.getElementById(id);
const openBtn=$('open-btn'),fileInput=$('file-input'),colorPick=$('color-pick'),
sizePick=$('size-pick'),widthPick=$('width-pick'),undoBtn=$('undo-btn'),redoBtn=$('redo-btn'),propsBtn=$('props-btn'),
pasteBtn=$('paste-btn'),scaleLabel=$('scale-label'),zoomOutBtn=$('zoom-out'),zoomInBtn=$('zoom-in'),zoomLabel=$('zoom-label'),downloadBtn=$('download-btn'),printBtn=$('print-btn'),
main=$('main'),emptyMsg=$('empty-msg'),prevBtn=$('prev-btn2'),nextBtn=$('next-btn2'),pageNumInput=$('page-num'),pageTotal=$('page-total'),
propsPanel=$('right-panel'),propsBody=$('props-body'),tabBar=$('tab-bar'),
pagesBtn=$('pages-btn'),pagesPanel=$('left-panel'),pagesList=$('pages-list'),
addBlankBtn=$('add-blank-btn'),insertPdfBtn=$('insert-pdf-btn'),insertPdfInput=$('insert-pdf-input');

const TOOL_TITLES={ select:'Select / Move', textselect:'Select Text', text:'Add Text', callout:'Callout', line:'Line', rect:'Rectangle', ellipse:'Circle/Ellipse',
  polygon:'Polygon (closed shape — click each corner, then close it)', polyline:'Polyline (open line — click each point, then finish it)', cloud:'Revision Cloud (click each corner, then close it)',
  highlighter:'Highlighter', scale:'Calibrate Scale', 'measure-length':'Measure Length', 'measure-area':'Measure Area', checkbox:'Checkbox', radio:'Radio Button', dropdown:'Dropdown' };

let pdfDoc=null, originalBytes=null, numPages=0, currentPage=1, scale=1.25;
// One entry per page, all stacked in a single scrolling column:
// {num, stage, canvas, svg, w, h, ptsW, ptsH, rendered, rendering}
let pageViews=[];
let drawPage=1;            // page the current draw / measure gesture belongs to
let viewMode='continuous'; // 'continuous' (all pages in one scrolling column) or 'single' (one page at a time); see applyViewMode in pages.js
let thumbW=182;            // width of a page thumbnail in the Pages panel, in px (the slider in that panel)
let tool='select';
let annotations={}; // page -> {texts:[],shapes:[],paths:[],measurements:[]}
let scaleInfo=null;
let isDragging=false, dragStart=null, dragPts=[];
let pendingPoints=[];
let selected=null; // {page, arrName, idx}
let historyStack=[], redoStack=[];
let docs=[], activeDoc=-1; // multi-tab: each doc holds its own file state
let clipboard=null; // copied text annotation, shared across tabs
let layoutToken=0, pageObserver=null, suppressClickUntil=0;
const EMPTY_PAGE={texts:[],shapes:[],paths:[],measurements:[],images:[],fields:[]};
// Phones get their own layout (body.phone, see shell.js): toolbar at the bottom, one menu button, panels that slide over the page.
// Portrait phones by width; phones on their side by height (with a touch screen, so a short desktop window keeps the normal layout).
// The phone layout is switched OFF for now: everyone gets the normal layout. Open the app with ?phone=1 on the end of the address to try it
// (set PHONE_LAYOUT to true to turn it on for everybody).
const PHONE_LAYOUT=(()=>{ try{ return new URLSearchParams(location.search).get('phone')==='1'; }catch(e){ return false; } })();
const PHONE_MQ=matchMedia(PHONE_LAYOUT?'(max-width:600px), (max-height:500px) and (pointer:coarse)':'not all');
const isPhone=()=>PHONE_MQ.matches;
const coarse=()=>matchMedia('(pointer:coarse)').matches; // a finger is the main pointer: bigger grab handles
const ZOOM_MIN=0.1, ZOOM_MAX=3; // engine scale (1.25 = 100%); the low end lets a whole drawing sheet fit a phone screen
const fitPad=()=>isPhone()?24:90; // room kept beside a page when fitting it to the window
let measureCtx=null; try{ measureCtx=document.createElement('canvas').getContext('2d'); }catch(e){}
