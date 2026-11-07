const vscode = acquireVsCodeApi();
let data = window.CODEFLOW;
const picker = document.getElementById("filePicker");
const fileView = document.getElementById("fileView");
const canvas = document.getElementById("canvas");
const svg = document.getElementById("links");
const diagram = document.getElementById("diagram");
const saveButton = document.getElementById("saveAnalysis");
const reanalyzeButton = document.getElementById("reanalyze");
const viewBackButton = document.getElementById("viewBack");
const viewForwardButton = document.getElementById("viewForward");
const minZoom = 0.25;
const maxZoom = 2;
const entryPortOffset = 7;
const callPortOffset = 25;
const portSpacing = 14;
let zoom = 1;
const boxPositions = new Map();
let currentFile;
let arrowsPending = false;
let notesDirty = false;
let notesRevision = 0;
let reanalysisPending = false;
const maxViewHistory = 5;
let viewHistory = [];
let viewHistoryIndex = -1;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function positionBox(node, id) {
  node.dataset.movableId = id;
  const position = boxPositions.get(id);
  if (position) {
    node.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }
}

function scheduleArrowRedraw() {
  if (arrowsPending || !currentFile) return;
  arrowsPending = true;
  requestAnimationFrame(() => {
    arrowsPending = false;
    drawCallArrows(currentFile);
  });
}

function populatePicker(requested = window.INITIAL_FILE) {
  picker.replaceChildren();
  for (const file of data.files) {
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = file.path;
    picker.appendChild(option);
  }

  picker.value = data.files.some(f => f.path === requested)
    ? requested
    : (data.files[0]?.path || "");
}

function variablePanel(title, variables) {
  const panel = el("section", "variable-panel");

  const heading = el("strong", "variable-heading", title);
  const list = el("div", "variable-list");
  if (!variables.length) {
    list.appendChild(el("span", "muted", "None detected"));
  } else {
    for (const variable of variables) {
      const label = typeof variable === "string" ? variable : variable.name;
      list.appendChild(el("span", "variable-chip", label));
    }
  }

  panel.append(heading, list);
  return panel;
}

function functionLink(fn, className) {
  const title = el("button", className, fn.name);
  title.type = "button";
  title.title = `${fn.qualifiedName} — line ${fn.line}; Ctrl+click to open in VS Code`;
  return title;
}

function noteEditor(value, label, onInput) {
  const editor = el("textarea", "box-note");
  editor.value = value || "";
  editor.placeholder = "Add a note…";
  editor.setAttribute("aria-label", label);
  editor.addEventListener("input", () => {
    onInput(editor.value);
    notesDirty = true;
    notesRevision++;
    saveButton.textContent = "Save notes *";
  });
  return editor;
}

function functionCard(fn) {
  const card = el("article", "function-card");
  card.dataset.nodeId = fn.id;
  positionBox(card, `function:${fn.id}`);
  const sourceCount = data.edges.filter(edge => edge.source === fn.id).length;
  const targetCount = data.edges.filter(edge => edge.target === fn.id).length;
  const portCount = Math.max(sourceCount, targetCount);
  card.style.minHeight = `${Math.max(128, 54 + portCount * 14 + 16)}px`;

  const header = el("div", "function-header");
  const title = functionLink(fn, "function-title");

  const inputs = variablePanel("Inputs", fn.params);
  header.append(title);
  const note = noteEditor(fn.note, `Notes for ${fn.qualifiedName}`, value => {
    fn.note = value;
  });

  const returns = el("section", "return-section");
  returns.appendChild(el("strong", "variable-heading", "Return values"));
  const returnList = el("div", "return-list");
  if (fn.returns.length) {
    fn.returns.forEach(value => returnList.appendChild(el("span", "return-chip", value)));
  } else {
    returnList.appendChild(el("span", "muted", "No explicit return detected"));
  }
  returns.appendChild(returnList);

  card.append(header, inputs, note, returns);
  return card;
}

function externalFunctionCard(fn, direction) {
  const card = el("section", `external-function external-${direction}`);
  const positionId = `external-${direction}:${fn.id}`;
  positionBox(card, positionId);
  card.dataset[direction === "caller" ? "externalCallerId" : "externalCalleeId"] = fn.id;
  const currentFunctionIds = new Set(currentFile.functions.map(currentFn => currentFn.id));
  const edgeCount = data.edges.filter(edge =>
    direction === "caller"
      ? edge.source === fn.id && currentFunctionIds.has(edge.target)
      : edge.target === fn.id && currentFunctionIds.has(edge.source)
  ).length;
  const portOffset = direction === "caller" ? callPortOffset : entryPortOffset;
  card.style.minHeight =
    `${Math.max(124, 26 + 34 + portOffset + Math.max(0, edgeCount - 1) * portSpacing + 10)}px`;
  card.title = `Show ${fn.file} in the diagram; Ctrl+click to open in VS Code`;
  const file = el("div", "external-function-file", fn.file);
  file.title = fn.file;
  const title = el("button", "external-function-title", fn.name);
  title.type = "button";
  title.setAttribute("aria-label", `Show ${fn.file} in the diagram`);
  const note = noteEditor(fn.note, `Notes for ${fn.qualifiedName}`, value => {
    fn.note = value;
  });
  note.addEventListener("click", event => event.stopPropagation());
  note.addEventListener("keydown", event => event.stopPropagation());
  card.append(file, title, note);
  const activate = openInEditor => {
    if (openInEditor) {
      vscode.postMessage({ command: "open", file: fn.file, line: fn.line });
    } else {
      picker.value = fn.file;
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
      recordView(fn.file);
      render();
    }
  };
  card.addEventListener("click", event => activate(event.ctrlKey));
  return card;
}

function renderFile(filePath) {
  const file = data.files.find(f => f.path === filePath);
  currentFile = file;
  fileView.replaceChildren();
  clearCallArrows();
  if (!file) return;

  const fileBox = el("section", "file-box");
  positionBox(fileBox, `file:${file.path}`);
  const fileTitle = el("div", "file-title", file.path);
  fileTitle.title = `${file.path} — module ${file.module}`;
  fileBox.appendChild(fileTitle);

  const content = el("div", "file-content");
  const classesById = new Map(file.classes.map(cls => [cls.id, cls]));
  const functionsById = new Map(file.functions.map(fn => [fn.id, fn]));

  for (const item of file.items) {
    if (item.kind === "class") {
      const cls = classesById.get(item.id);
      if (!cls) continue;

      const classBox = el("section", "class-box");
      classBox.dataset.classId = cls.id;
      positionBox(classBox, `class:${cls.id}`);
      classBox.appendChild(el("div", "class-title", cls.name));
      classBox.appendChild(noteEditor(cls.note, `Notes for ${cls.qualifiedName}`, value => {
        cls.note = value;
      }));
      const methods = el("div", "class-methods");

      cls.methods
        .slice()
        .sort((a, b) => a.order - b.order)
        .forEach(fn => methods.appendChild(functionCard(fn)));

      classBox.appendChild(methods);
      content.appendChild(classBox);
    } else {
      const fn = functionsById.get(item.id);
      if (fn) content.appendChild(functionCard(fn));
    }
  }

  if (!file.items.length) {
    content.appendChild(el("p", "empty", "No classes or functions were found in this file."));
  }

  fileBox.appendChild(content);

  const allFunctionsById = new Map(
    data.files.flatMap(candidate => candidate.functions.map(fn => [fn.id, fn]))
  );
  fileBox.addEventListener("click", event => {
    if (!event.ctrlKey || !(event.target instanceof Element)) return;

    const functionCard = event.target.closest(".function-card");
    if (functionCard) {
      const fn = allFunctionsById.get(functionCard.dataset.nodeId);
      if (fn) {
        vscode.postMessage({ command: "open", file: fn.file, line: fn.line });
        return;
      }
    }

    const classBox = event.target.closest(".class-box");
    const cls = classBox && classesById.get(classBox.dataset.classId);
    vscode.postMessage({
      command: "open",
      file: cls ? cls.file : file.path,
      line: cls ? cls.line : 1
    });
  });
  const incomingEdges = data.edges.filter(edge => {
    const source = allFunctionsById.get(edge.source);
    const target = allFunctionsById.get(edge.target);
    return source && target && source.file !== file.path && target.file === file.path;
  });
  const callers = [...new Set(incomingEdges.map(edge => edge.source))]
    .map(id => allFunctionsById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file) || a.order - b.order);
  const currentFunctionIds = new Set(file.functions.map(fn => fn.id));
  const internalEdgeCount = data.edges.filter(
    edge => currentFunctionIds.has(edge.source) && currentFunctionIds.has(edge.target)
  ).length;
  const outgoingEdges = data.edges.filter(edge => {
    const source = allFunctionsById.get(edge.source);
    const target = allFunctionsById.get(edge.target);
    return source && target && source.file === file.path && target.file !== file.path;
  });
  const outgoingOrder = new Map();
  for (const edge of outgoingEdges) {
    const source = allFunctionsById.get(edge.source);
    const current = outgoingOrder.get(edge.target);
    if (!current || source.order < current.sourceOrder ||
        (source.order === current.sourceOrder && edge.line < current.callLine)) {
      outgoingOrder.set(edge.target, {
        sourceOrder: source.order,
        callLine: edge.line
      });
    }
  }
  const callees = [...new Set(outgoingEdges.map(edge => edge.target))]
    .map(id => allFunctionsById.get(id))
    .filter(Boolean)
    .sort((a, b) => {
      const aOrder = outgoingOrder.get(a.id);
      const bOrder = outgoingOrder.get(b.id);
      return aOrder.sourceOrder - bOrder.sourceOrder ||
        aOrder.callLine - bOrder.callLine ||
        a.file.localeCompare(b.file) ||
        a.order - b.order;
    });

  if (callers.length) {
    const externalCallers = el("aside", "external-callers");
    externalCallers.setAttribute("aria-label", "Callers from other files");
    callers.forEach(fn => externalCallers.appendChild(externalFunctionCard(fn, "caller")));
    const separator = el("div", "file-separator");
    separator.style.flexBasis = `${incomingEdges.length * 10 + 16}px`;
    separator.setAttribute("role", "separator");
    separator.setAttribute("aria-label", "Outside and inside this file");
    fileView.append(externalCallers, separator);
  }
  fileView.appendChild(fileBox);
  if (callees.length || internalEdgeCount) {
    const separator = el("div", "file-separator right");
    separator.style.flexBasis = `${(internalEdgeCount + outgoingEdges.length) * 10 + 16}px`;
    separator.setAttribute("role", "separator");
    separator.setAttribute("aria-label", "Inside and outside this file");
    fileView.appendChild(separator);
    if (callees.length) {
      const externalCallees = el("aside", "external-callees");
      externalCallees.setAttribute("aria-label", "Called functions from other files");
      callees.forEach(fn => externalCallees.appendChild(externalFunctionCard(fn, "callee")));
      fileView.appendChild(externalCallees);
    }
  }

  requestAnimationFrame(() => drawCallArrows(file));
  document.getElementById("summary").textContent =
    `${file.functions.length} functions · ${file.classes.length} classes`;
}

function clearCallArrows() {
  svg.querySelectorAll(
    ".call-arrow, .call-arrow-hit, .call-source-node, .call-target-node, " +
    ".call-crossing-mask, .call-crossing-bridge"
  ).forEach(node => node.remove());
}

function drawCallArrows(file) {
  clearCallArrows();
  const diagramRect = diagram.getBoundingClientRect();
  const cards = new Map();
  const externalCallers = new Map();
  const externalCallees = new Map();

  file.functions.forEach(fn => {
    const card = fileView.querySelector(`[data-node-id="${CSS.escape(fn.id)}"]`);
    if (card) cards.set(fn.id, card);
  });
  fileView.querySelectorAll("[data-external-caller-id]").forEach(card => {
    externalCallers.set(card.dataset.externalCallerId, card);
  });
  fileView.querySelectorAll("[data-external-callee-id]").forEach(card => {
    externalCallees.set(card.dataset.externalCalleeId, card);
  });

  const links = data.edges.filter(edge =>
    cards.has(edge.source) && cards.has(edge.target)
  );
  const incomingLinks = data.edges.filter(edge =>
    externalCallers.has(edge.source) && cards.has(edge.target)
  );
  const outgoingLinks = data.edges.filter(edge =>
    cards.has(edge.source) && externalCallees.has(edge.target)
  );
  const allLinks = [...links, ...incomingLinks, ...outgoingLinks];
  const endpointGroups = new Map();
  const edgePorts = new Map();
  const addEndpoint = (edge, side, node) => {
    if (!node) return;
    const key = `${side}:${edge[side === "source" ? "source" : "target"]}`;
    if (!endpointGroups.has(key)) endpointGroups.set(key, { node, side, endpoints: [] });
    endpointGroups.get(key).endpoints.push(edge);
  };
  for (const edge of allLinks) {
    const source = cards.get(edge.source) || externalCallers.get(edge.source);
    const target = cards.get(edge.target) || externalCallees.get(edge.target);
    edgePorts.set(edge, {});
    addEndpoint(edge, "source", source);
    addEndpoint(edge, "target", target);
  }

  const routes = [];
  for (const { node, side, endpoints } of endpointGroups.values()) {
    endpoints.sort((a, b) =>
      a.line - b.line ||
      a.source.localeCompare(b.source) ||
      a.target.localeCompare(b.target)
    );
    const rect = node.getBoundingClientRect();
    const header = node.querySelector(
      node.classList.contains("function-card") ? ".function-header" : ".external-function-title"
    );
    const firstPortY = header
      ? (header.getBoundingClientRect().bottom - diagramRect.top) / zoom +
        (side === "source" ? callPortOffset : entryPortOffset)
      : (rect.top - diagramRect.top) / zoom + 12;
    endpoints.forEach((edge, index) => {
      edgePorts.get(edge)[side] = firstPortY + index * portSpacing;
    });
  }

  const appendArrow = (pathData, sx, sy, tx, ty, lane, edgeIndex, edge) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", "call-arrow");
    path.dataset.edgeIndex = String(edgeIndex);
    path.setAttribute("marker-end", "url(#arrowhead)");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${edge.source} → ${edge.target} (line ${edge.line})`;
    path.appendChild(title);
    svg.appendChild(path);

    const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitArea.setAttribute("d", pathData);
    hitArea.setAttribute("class", "call-arrow-hit");
    hitArea.dataset.edgeIndex = String(edgeIndex);
    svg.appendChild(hitArea);

    const node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    node.setAttribute("cx", String(sx));
    node.setAttribute("cy", String(sy));
    node.setAttribute("r", "4");
    node.setAttribute("class", "call-source-node");
    node.dataset.edgeIndex = String(edgeIndex);
    svg.appendChild(node);

    const targetNode = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    targetNode.setAttribute("cx", String(tx));
    targetNode.setAttribute("cy", String(ty));
    targetNode.setAttribute("r", "3");
    targetNode.setAttribute("class", "call-target-node");
    targetNode.dataset.edgeIndex = String(edgeIndex);
    svg.appendChild(targetNode);
    routes.push({
      lane,
      edgeIndex,
      vertical: { y1: sy, y2: ty },
      horizontals: [
        { x1: sx, x2: lane, y: sy },
        { x1: lane, x2: tx, y: ty }
      ]
    });
  };

  const width = Math.max(diagram.scrollWidth, fileView.scrollWidth, 1100);
  const height = Math.max(diagram.scrollHeight, fileView.scrollHeight);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const leftSeparator = fileView.querySelector(".file-separator:not(.right)");
  const rightSeparator = fileView.querySelector(".file-separator.right");
  const separatorX = separator => separator
    ? (separator.getBoundingClientRect().left - diagramRect.left) / zoom + 8
    : 0;
  const leftLaneStart = separatorX(leftSeparator);
  const rightLaneStart = separatorX(rightSeparator);
  const internalLaneCount = links.length;

  let edgeIndex = 0;
  links.forEach((edge, index) => {
    const from = cards.get(edge.source).getBoundingClientRect();
    const to = cards.get(edge.target).getBoundingClientRect();
    const sx = (from.right - diagramRect.left) / zoom;
    const sy = edgePorts.get(edge).source;
    const tx = (to.right - diagramRect.left) / zoom;
    const ty = edgePorts.get(edge).target;
    const lane = rightLaneStart + index * 10;
    appendArrow(
      `M ${sx} ${sy} H ${lane} V ${ty} H ${tx}`,
      sx, sy, tx, ty, lane, edgeIndex++, edge
    );
  });

  incomingLinks.forEach((edge, index) => {
    const from = externalCallers.get(edge.source).getBoundingClientRect();
    const to = cards.get(edge.target).getBoundingClientRect();
    const sx = (from.right - diagramRect.left) / zoom;
    const sy = edgePorts.get(edge).source;
    const tx = (to.left - diagramRect.left) / zoom;
    const ty = edgePorts.get(edge).target;
    const lane = leftLaneStart + index * 10;
    appendArrow(
      `M ${sx} ${sy} H ${lane} V ${ty} H ${tx}`,
      sx, sy, tx, ty, lane, edgeIndex++, edge
    );
  });

  outgoingLinks.forEach((edge, index) => {
    const from = cards.get(edge.source).getBoundingClientRect();
    const to = externalCallees.get(edge.target).getBoundingClientRect();
    const sx = (from.right - diagramRect.left) / zoom;
    const sy = edgePorts.get(edge).source;
    const tx = (to.left - diagramRect.left) / zoom;
    const ty = edgePorts.get(edge).target;
    const lane = rightLaneStart + (internalLaneCount + index) * 10;
    appendArrow(
      `M ${sx} ${sy} H ${lane} V ${ty} H ${tx}`,
      sx, sy, tx, ty, lane, edgeIndex++, edge
    );
  });

  const addCrossingBridge = (x, y, edgeIndexes) => {
    const mask = document.createElementNS("http://www.w3.org/2000/svg", "path");
    mask.setAttribute("d", `M ${x - 6} ${y} H ${x + 6}`);
    mask.setAttribute("class", "call-crossing-mask");
    svg.appendChild(mask);

    const bridge = document.createElementNS("http://www.w3.org/2000/svg", "path");
    bridge.setAttribute("d", `M ${x - 6} ${y} C ${x - 2} ${y - 5} ${x + 2} ${y - 5} ${x + 6} ${y}`);
    bridge.setAttribute("class", "call-crossing-bridge");
    bridge.dataset.edgeIndexes = edgeIndexes.join(",");
    svg.appendChild(bridge);
  };
  const crosses = (horizontal, vertical) => {
    const minX = Math.min(horizontal.x1, horizontal.x2);
    const maxX = Math.max(horizontal.x1, horizontal.x2);
    const minY = Math.min(vertical.y1, vertical.y2);
    const maxY = Math.max(vertical.y1, vertical.y2);
    return vertical.lane > minX + 6 && vertical.lane < maxX - 6 &&
      horizontal.y > minY + 6 && horizontal.y < maxY - 6;
  };
  for (let first = 0; first < routes.length; first++) {
    for (let second = first + 1; second < routes.length; second++) {
      for (const horizontal of routes[first].horizontals) {
        const vertical = { ...routes[second].vertical, lane: routes[second].lane };
        if (crosses(horizontal, vertical)) {
          addCrossingBridge(vertical.lane, horizontal.y, [
            routes[first].edgeIndex, routes[second].edgeIndex
          ]);
        }
      }
      for (const horizontal of routes[second].horizontals) {
        const vertical = { ...routes[first].vertical, lane: routes[first].lane };
        if (crosses(horizontal, vertical)) {
          addCrossingBridge(vertical.lane, horizontal.y, [
            routes[first].edgeIndex, routes[second].edgeIndex
          ]);
        }
      }
    }
  }
}

function render() {
  renderFile(picker.value);
}

function updateViewHistoryButtons() {
  viewBackButton.disabled = viewHistoryIndex <= 0;
  viewForwardButton.disabled =
    viewHistoryIndex < 0 || viewHistoryIndex >= viewHistory.length - 1;
}

function recordView(filePath) {
  if (!filePath || viewHistory[viewHistoryIndex] === filePath) return;
  viewHistory = viewHistory.slice(0, viewHistoryIndex + 1);
  viewHistory.push(filePath);
  if (viewHistory.length > maxViewHistory) viewHistory.shift();
  viewHistoryIndex = viewHistory.length - 1;
  updateViewHistoryButtons();
}

function reconcileViewHistory(currentFilePath) {
  const previousIndex = viewHistoryIndex;
  const availablePaths = new Set(data.files.map(file => file.path));
  const entries = viewHistory
    .map((filePath, index) => ({ filePath, index }))
    .filter(entry => availablePaths.has(entry.filePath));
  viewHistory = entries.map(entry => entry.filePath);
  viewHistoryIndex = entries.filter(entry => entry.index <= previousIndex).length - 1;
  if (viewHistory[viewHistoryIndex] !== currentFilePath) {
    viewHistory = viewHistory.slice(0, viewHistoryIndex + 1);
    recordView(currentFilePath);
  } else {
    updateViewHistoryButtons();
  }
}

function showHistoryView(index) {
  const filePath = viewHistory[index];
  if (!data.files.some(file => file.path === filePath)) return;
  viewHistoryIndex = index;
  picker.value = filePath;
  render();
  updateViewHistoryButtons();
}

function setZoom(nextZoom, anchorX = canvas.clientWidth / 2, anchorY = canvas.clientHeight / 2) {
  const next = Math.min(maxZoom, Math.max(minZoom, nextZoom));
  if (next === zoom) return;

  const style = getComputedStyle(canvas);
  const paddingLeft = parseFloat(style.paddingLeft);
  const paddingTop = parseFloat(style.paddingTop);
  const contentX = (canvas.scrollLeft + anchorX - paddingLeft) / zoom;
  const contentY = (canvas.scrollTop + anchorY - paddingTop) / zoom;
  zoom = next;
  diagram.style.transform = `scale(${zoom})`;
  canvas.scrollLeft = paddingLeft + contentX * zoom - anchorX;
  canvas.scrollTop = paddingTop + contentY * zoom - anchorY;
}

function fitDiagram() {
  const style = getComputedStyle(canvas);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const width = Math.max(diagram.scrollWidth, fileView.scrollWidth);
  const height = Math.max(diagram.scrollHeight, fileView.scrollHeight);
  const nextZoom = Math.min(
    maxZoom,
    Math.max(minZoom, Math.min(
      (canvas.clientWidth - paddingX) / width,
      (canvas.clientHeight - paddingY) / height
    ))
  );
  zoom = nextZoom;
  diagram.style.transform = `scale(${zoom})`;
  canvas.scrollLeft = 0;
  canvas.scrollTop = 0;
}

let dragStart;
let dragged = false;
let suppressClick = false;

canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.pointerType !== "mouse") return;
  if (event.target instanceof Element &&
      event.target.closest("button, input, select, textarea")) return;
  const movable = event.target instanceof Element
    ? event.target.closest("[data-movable-id]")
    : null;
  if (event.altKey && movable) {
    const positionId = movable.dataset.movableId;
    const position = boxPositions.get(positionId) || { x: 0, y: 0 };
    dragStart = {
      pointerId: event.pointerId,
      mode: "box",
      element: movable,
      positionId,
      x: event.clientX,
      y: event.clientY,
      offsetX: position.x,
      offsetY: position.y
    };
    dragged = false;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  dragStart = {
    pointerId: event.pointerId,
    mode: "pan",
    x: event.clientX,
    y: event.clientY,
    scrollLeft: canvas.scrollLeft,
    scrollTop: canvas.scrollTop
  };
  dragged = false;
  if (event.target instanceof Element) {
    event.target.setPointerCapture(event.pointerId);
  }
});

canvas.addEventListener("pointermove", event => {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  const deltaX = event.clientX - dragStart.x;
  const deltaY = event.clientY - dragStart.y;
  if (!dragged && Math.hypot(deltaX, deltaY) < 4) return;
  dragged = true;
  if (dragStart.mode === "box") {
    const position = {
      x: dragStart.offsetX + deltaX / zoom,
      y: dragStart.offsetY + deltaY / zoom
    };
    boxPositions.set(dragStart.positionId, position);
    dragStart.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
    canvas.classList.add("is-moving-box");
    scheduleArrowRedraw();
    event.preventDefault();
    return;
  }
  canvas.classList.add("is-panning");
  canvas.scrollLeft = dragStart.scrollLeft - deltaX;
  canvas.scrollTop = dragStart.scrollTop - deltaY;
  event.preventDefault();
});

function finishDrag(event) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  suppressClick = dragged;
  if (dragStart.mode === "box") canvas.classList.remove("is-moving-box");
  dragStart = undefined;
  canvas.classList.remove("is-panning", "is-moving-box");
  if (suppressClick) {
    window.setTimeout(() => { suppressClick = false; }, 0);
  }
}

canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);
canvas.addEventListener("wheel", event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  setZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
    event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
canvas.addEventListener("click", event => {
  if (!suppressClick) return;
  event.preventDefault();
  event.stopPropagation();
  suppressClick = false;
}, true);
canvas.addEventListener("click", event => {
  const hitArea = event.target instanceof Element
    ? event.target.closest(".call-arrow-hit")
    : null;
  svg.querySelectorAll(
    ".call-arrow.is-highlighted, .is-highlighted-endpoint, " +
    ".call-crossing-bridge.is-highlighted"
  )
    .forEach(element => element.classList.remove("is-highlighted", "is-highlighted-endpoint"));
  if (!hitArea) return;

  const edgeIndex = hitArea.dataset.edgeIndex;
  svg.querySelector(`.call-arrow[data-edge-index="${edgeIndex}"]`)
    ?.classList.add("is-highlighted");
  svg.querySelectorAll(`[data-edge-index="${edgeIndex}"].call-source-node, ` +
    `[data-edge-index="${edgeIndex}"].call-target-node`)
    .forEach(node => node.classList.add("is-highlighted-endpoint"));
  svg.querySelectorAll(".call-crossing-bridge").forEach(bridge => {
    if (bridge.dataset.edgeIndexes.split(",").includes(edgeIndex)) {
      bridge.classList.add("is-highlighted");
    }
  });
});

picker.addEventListener("change", () => {
  recordView(picker.value);
  render();
});
viewBackButton.addEventListener("click", () => {
  if (viewHistoryIndex > 0) showHistoryView(viewHistoryIndex - 1);
});
viewForwardButton.addEventListener("click", () => {
  if (viewHistoryIndex < viewHistory.length - 1) {
    showHistoryView(viewHistoryIndex + 1);
  }
});
document.getElementById("zoomIn").addEventListener("click", () => setZoom(zoom * 1.2));
document.getElementById("zoomOut").addEventListener("click", () => setZoom(zoom / 1.2));
document.getElementById("fitDiagram").addEventListener("click", fitDiagram);
window.addEventListener("keydown", event => {
  if (event.ctrlKey || event.altKey || event.metaKey ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(zoom * 1.2);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    setZoom(zoom / 1.2);
  }
});
window.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!saveButton.disabled) saveButton.click();
  }
}, true);
document.getElementById("resetFile").addEventListener("click", () => {
  vscode.postMessage({ command: "reset-active-file" });
});
reanalyzeButton.addEventListener("click", () => {
  reanalysisPending = true;
  reanalyzeButton.disabled = true;
  if (!saveButton.disabled) saveButton.click();
});
saveButton.addEventListener("click", () => {
  const functions = {};
  const classes = {};
  for (const file of data.files) {
    for (const fn of file.functions) {
      if (typeof fn.note === "string") functions[fn.id] = fn.note;
    }
    for (const cls of file.classes) {
      if (typeof cls.note === "string") classes[cls.id] = cls.note;
      for (const fn of cls.methods) {
        if (typeof fn.note === "string") functions[fn.id] = fn.note;
      }
    }
  }
  const revision = notesRevision;
  saveButton.disabled = true;
  vscode.postMessage({ command: "save-notes", functions, classes, revision });
});

window.addEventListener("message", event => {
  if (event.data?.command === "update-analysis") {
    const selectedFile = picker.value;
    data = event.data.analysis;
    const keepSelectedFile = data.files.some(file => file.path === selectedFile);
    populatePicker(keepSelectedFile ? selectedFile : event.data.initialFile);
    reconcileViewHistory(picker.value);
    render();
  } else if (event.data?.command === "select-file") {
    const exists = Array.from(picker.options).some(o => o.value === event.data.path);
    if (exists) {
      picker.value = event.data.path;
      recordView(event.data.path);
      render();
    } else {
      const message = `The active file is not part of this workspace analysis: ${event.data.path}`;
      document.getElementById("summary").textContent = message;
    }
  } else if (event.data?.command === "save-result") {
    saveButton.disabled = false;
    if (event.data.success && event.data.revision === notesRevision) {
      notesDirty = false;
      saveButton.textContent = "Saved";
      if (reanalysisPending) {
        vscode.postMessage({ command: "reanalyze" });
      }
      window.setTimeout(() => {
        if (!notesDirty) saveButton.textContent = "Save notes";
      }, 1800);
    } else {
      saveButton.textContent = "Save notes *";
      if (reanalysisPending && !event.data.success) {
        reanalysisPending = false;
        reanalyzeButton.disabled = false;
      } else if (reanalysisPending) {
        saveButton.click();
      }
    }
  } else if (event.data?.command === "reanalyze-result") {
    reanalysisPending = false;
    reanalyzeButton.disabled = false;
  }
});

svg.innerHTML = `<defs>
  <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
    <path d="M0,0 L8,4 L0,8 z" fill="#3987c9"></path>
  </marker>
  <marker id="arrowheadSelected" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
    <path d="M0,0 L8,4 L0,8 z" fill="#ffbf47"></path>
  </marker>
</defs>`;

populatePicker();
recordView(picker.value);
render();
