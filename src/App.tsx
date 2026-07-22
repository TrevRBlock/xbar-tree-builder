import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";

import { toPng } from "html-to-image";

import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  getNodesBounds,
  useEdgesState,
  useNodes,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./App.css";

type NodeKind =
  | "phrase"
  | "head"
  | "word"
  | "wordInput"
  | "movementSummary";

type TreeLayoutMode =
  | "topDown"
  | "bottomUp";

interface SyntaxNodeData
  extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  isLowerCopy?: boolean;
  textBold?: boolean;
  textItalic?: boolean;
  textStrikethrough?: boolean;
}

type TextFormatKey =
  | "textBold"
  | "textItalic"
  | "textStrikethrough";

function isNodeTextBold(
  data: SyntaxNodeData,
): boolean {
  /*
   * Phrase and head labels retain their
   * existing bold default. A stored value
   * explicitly overrides that default.
   */
  return (
    data.textBold ??
    (
      data.kind === "phrase" ||
      data.kind === "head"
    )
  );
}

function getNodeTextFormatState(
  data: SyntaxNodeData,
  formatKey: TextFormatKey,
): boolean {
  if (formatKey === "textBold") {
    return isNodeTextBold(data);
  }

  return Boolean(data[formatKey]);
}

type SyntaxNode = Node<
  SyntaxNodeData,
  "syntaxNode"
>;

interface PaletteItem {
  label: string;
  kind: NodeKind;
}

type MaximalProjection =
  | "AdjP"
  | "AdvP"
  | "AuxP"
  | "ClassP"
  | "CP"
  | "DP"
  | "FocP"
  | "NP"
  | "PerfP"
  | "PP"
  | "ProgP"
  | "QP"
  | "TopP"
  | "TP"
  | "VoiceP"
  | "VP"
  | "vP";

const projectionChains: Record<
  MaximalProjection,
  readonly [
    phrase: string,
    intermediate: string,
    head: string,
  ]
> = {
  AdjP: ["AdjP", "Adj′", "Adj"],
  AdvP: ["AdvP", "Adv′", "Adv"],
  AuxP: ["AuxP", "Aux′", "Aux"],
  ClassP: ["ClassP", "Class'", "Class"],
  CP: ["CP", "C′", "C"],
  DP: ["DP", "D′", "D"],
  FocP: ["FocP", "Foc'", "Foc"],
  NP: ["NP", "N′", "N"],
  PerfP: ["PerfP", "Perf'", "Perf"],
  PP: ["PP", "P′", "P"],
  ProgP: ["ProgP", "Prog'", "Prog"],
  QP: ["QP", "Q′", "Q"],
  TopP: ["TopP", "Top'", "Top"],
  TP: ["TP", "T′", "T"],
  VoiceP: ["VoiceP", "Voice'", "Voice"],
  VP: ["VP", "V′", "V"],
  vP: ["vP", "v′", "v"],
};

function isMaximalProjection(
  label: string,
): label is MaximalProjection {
  return Object.prototype.hasOwnProperty.call(
    projectionChains,
    label,
  );
}

function getDefaultLexicalLabelForHead(
  headLabel: string,
): string {
  return (
    headLabel === "C" ||
    headLabel === "T"
  )
    ? "∅"
    : "";
}

const DRAG_DATA_TYPE =
  "application/x-xbar-node";

const FOCUS_LEXICAL_NODE_EVENT =
  "xbar-focus-lexical-node";

interface FocusLexicalNodeDetail {
  nodeId: string;
}

const phraseLabels: PaletteItem[] = [
  { label: "AdjP", kind: "phrase" },
  { label: "AdvP", kind: "phrase" },
  { label: "AuxP", kind: "phrase" },
  { label: "ClassP", kind: "phrase" },
  { label: "CP", kind: "phrase" },
  { label: "DP", kind: "phrase" },
  { label: "FocP", kind: "phrase" },
  { label: "NP", kind: "phrase" },
  { label: "PerfP", kind: "phrase" },
  { label: "PP", kind: "phrase" },
  { label: "ProgP", kind: "phrase" },
  { label: "QP", kind: "phrase" },
  { label: "TopP", kind: "phrase" },
  { label: "TP", kind: "phrase" },
  { label: "VoiceP", kind: "phrase" },
  { label: "VP", kind: "phrase" },
  { label: "vP", kind: "phrase" },
];

const headLabels: PaletteItem[] = [
  { label: "Adj", kind: "head" },
  { label: "Adv", kind: "head" },
  { label: "Aux", kind: "head" },
  { label: "C", kind: "head" },
  { label: "Class", kind: "head" },
  { label: "D", kind: "head" },
  { label: "Focus", kind: "head" },
  { label: "N", kind: "head" },
  { label: "P", kind: "head" },
  { label: "Perf", kind: "head" },
  { label: "Prog", kind: "head" },
  { label: "Q", kind: "head" },
  { label: "Qual", kind: "head" },
  { label: "T", kind: "head" },
  { label: "Top", kind: "head" },
  { label: "V", kind: "head" },
  { label: "Voice", kind: "head" },
  { label: "v", kind: "head" },
];

interface TreeSnapshot {
  nodes: SyntaxNode[];
  edges: Edge[];
}

const UndoContext =
  createContext<(() => void) | null>(
    null,
  );

interface DisplayOptionsContextValue {
  showNodeBoxes: boolean;
  showMovementArrows: boolean;
  showHeadWordLines: boolean;
  collapseUnusedBarLevels: boolean;
  treeLayoutMode: TreeLayoutMode;
  requestAutoBalance: () => void;
}

const DisplayOptionsContext =
  createContext<DisplayOptionsContextValue>({
    showNodeBoxes: true,
    showMovementArrows: true,
    showHeadWordLines: true,
    collapseUnusedBarLevels: false,
    treeLayoutMode: "topDown",
    requestAutoBalance: () => {},
  });

function createTreeSnapshot(
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
): TreeSnapshot {
  return {
    nodes: currentNodes.map((node) => ({
      ...node,

      position: {
        ...node.position,
      },

      data: {
        ...node.data,
      },

      selected: false,
      dragging: false,
    })),

    edges: currentEdges.map((edge) => ({
      ...edge,

      data: edge.data
        ? {
            ...edge.data,
          }
        : undefined,

      selected: false,
    })),
  };
}

function getAdjacentLexicalNodeId(
  currentNodeId: string,
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
  direction: 1 | -1,
): string | null {
  const nodeById =
    new Map(
      currentNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const structuralEdges =
    currentEdges.filter(
      (edge) =>
        !isMovementEdge(edge),
    );

  const childEdgesByParent =
    new Map<string, Edge[]>();

  const nodeIdsWithParents =
    new Set<string>();

  for (const edge of structuralEdges) {
    if (
      !nodeById.has(edge.source) ||
      !nodeById.has(edge.target)
    ) {
      continue;
    }

    const childEdges =
      childEdgesByParent.get(
        edge.source,
      ) ?? [];

    childEdgesByParent.set(
      edge.source,
      [
        ...childEdges,
        edge,
      ],
    );

    nodeIdsWithParents.add(
      edge.target,
    );
  }

  function getNodeCentreX(
    node: SyntaxNode,
  ): number {
    return (
      node.position.x +
      (
        node.measured?.width ??
        getSyntaxNodeWidth(node)
      ) /
        2
    );
  }

  function compareNodesLeftToRight(
    firstNode: SyntaxNode,
    secondNode: SyntaxNode,
  ): number {
    const horizontalDifference =
      getNodeCentreX(firstNode) -
      getNodeCentreX(secondNode);

    if (
      Math.abs(
        horizontalDifference,
      ) > 0.5
    ) {
      return horizontalDifference;
    }

    const verticalDifference =
      firstNode.position.y -
      secondNode.position.y;

    if (
      Math.abs(
        verticalDifference,
      ) > 0.5
    ) {
      return verticalDifference;
    }

    return firstNode.id.localeCompare(
      secondNode.id,
    );
  }

  const rootNodes =
    currentNodes
      .filter(
        (node) =>
          !nodeIdsWithParents.has(
            node.id,
          ),
      )
      .sort(
        compareNodesLeftToRight,
      );

  const orderedLexicalNodeIds:
    string[] = [];

  const visitedNodeIds =
    new Set<string>();

  function visitNode(
    nodeId: string,
  ) {
    if (
      visitedNodeIds.has(nodeId)
    ) {
      return;
    }

    visitedNodeIds.add(nodeId);

    const node =
      nodeById.get(nodeId);

    if (!node) {
      return;
    }

    if (
      (
        node.data.kind === "word" ||
        node.data.kind ===
          "wordInput"
      ) &&
      !node.data.isLowerCopy
    ) {
      orderedLexicalNodeIds.push(
        node.id,
      );

      return;
    }

    const orderedChildEdges =
      [
        ...(
          childEdgesByParent.get(
            nodeId,
          ) ?? []
        ),
      ].sort(
        (
          firstEdge,
          secondEdge,
        ) => {
          const orderDifference =
            getSiblingOrder(
              firstEdge,
            ) -
            getSiblingOrder(
              secondEdge,
            );

          if (orderDifference !== 0) {
            return orderDifference;
          }

          const firstChild =
            nodeById.get(
              firstEdge.target,
            );

          const secondChild =
            nodeById.get(
              secondEdge.target,
            );

          if (
            firstChild &&
            secondChild
          ) {
            return compareNodesLeftToRight(
              firstChild,
              secondChild,
            );
          }

          return firstEdge.target
            .localeCompare(
              secondEdge.target,
            );
        },
      );

    for (
      const childEdge
      of orderedChildEdges
    ) {
      visitNode(
        childEdge.target,
      );
    }
  }

  /*
   * Traverse each structural tree in its
   * true sister order. This includes
   * lexical terminals under C, T, V, and
   * every other head, even when several
   * terminals have similar x coordinates.
   */
  for (const rootNode of rootNodes) {
    visitNode(rootNode.id);
  }

  /*
   * Malformed or temporarily detached
   * lexical nodes should still remain
   * reachable through Tab navigation.
   */
  const unvisitedLexicalNodes =
    currentNodes
      .filter(
        (node) =>
          (
            node.data.kind ===
              "word" ||
            node.data.kind ===
              "wordInput"
          ) &&
          !node.data.isLowerCopy &&
          !orderedLexicalNodeIds.includes(
            node.id,
          ),
      )
      .sort(
        compareNodesLeftToRight,
      );

  for (
    const lexicalNode
    of unvisitedLexicalNodes
  ) {
    orderedLexicalNodeIds.push(
      lexicalNode.id,
    );
  }

  if (
    orderedLexicalNodeIds.length ===
    0
  ) {
    return null;
  }

  const currentIndex =
    orderedLexicalNodeIds.indexOf(
      currentNodeId,
    );

  if (currentIndex === -1) {
    return orderedLexicalNodeIds[0];
  }

  const nextIndex =
    (
      currentIndex +
      direction +
      orderedLexicalNodeIds.length
    ) %
    orderedLexicalNodeIds.length;

  return orderedLexicalNodeIds[
    nextIndex
  ];
}

function SyntaxNodeComponent({
  id,
  data,
  selected,
}: NodeProps<SyntaxNode>) {
  const reactFlow =
    useReactFlow<SyntaxNode, Edge>();

  const saveUndoSnapshot =
    useContext(UndoContext);

  const {
    showNodeBoxes,
    requestAutoBalance,
  } = useContext(
    DisplayOptionsContext,
  );

  const updateNodeInternals =
    useUpdateNodeInternals();

  const [isEditing, setIsEditing] =
    useState(false);

  const isMovementSummary =
    data.kind === "movementSummary";

  const isLockedMovementNode =
    Boolean(data.isLowerCopy) ||
    isMovementSummary;

  const canHaveChildren =
    data.kind !== "word" &&
    data.kind !== "wordInput" &&
    data.kind !== "movementSummary";

  const labelLines =
    data.label
      .replace(/\r\n?/g, "\n")
      .split("\n");

  const longestLabelLineLength =
    Math.max(
      1,
      ...labelLines.map(
        (line) =>
          Array.from(line).length,
      ),
    );

  const nodeTextStyle: CSSProperties = {
    fontWeight:
      isNodeTextBold(data)
        ? 700
        : 400,
    fontStyle:
      data.textItalic
        ? "italic"
        : "normal",
    textDecorationLine:
      data.textStrikethrough
        ? "line-through"
        : "none",
    textDecorationThickness:
      data.textStrikethrough
        ? "2px"
        : undefined,
    whiteSpace: "pre",
    textAlign: "center",
    lineHeight: 1.2,
  };

  const summaryWidth =
    Math.max(
      120,
      longestLabelLineLength *
        9 +
        30,
    );

  useEffect(() => {
    function handleLexicalFocus(
      event: Event,
    ) {
      const focusEvent =
        event as CustomEvent<
          FocusLexicalNodeDetail
        >;

      if (
        focusEvent.detail?.nodeId !==
        id
      ) {
        return;
      }

      const isEditableLexicalNode =
        (
          data.kind === "word" ||
          data.kind === "wordInput"
        ) &&
        !data.isLowerCopy;

      if (!isEditableLexicalNode) {
        return;
      }

      saveUndoSnapshot?.();
      setIsEditing(true);
    }

    window.addEventListener(
      FOCUS_LEXICAL_NODE_EVENT,
      handleLexicalFocus,
    );

    return () => {
      window.removeEventListener(
        FOCUS_LEXICAL_NODE_EVENT,
        handleLexicalFocus,
      );
    };
  }, [
    data.isLowerCopy,
    data.kind,
    id,
    saveUndoSnapshot,
  ]);

  useEffect(() => {
    const animationFrame =
      requestAnimationFrame(() => {
        updateNodeInternals(id);
      });

    return () => {
      cancelAnimationFrame(
        animationFrame,
      );
    };
  }, [
    data.label,
    data.textBold,
    data.textItalic,
    data.textStrikethrough,
    id,
    isEditing,
    showNodeBoxes,
    updateNodeInternals,
  ]);

  function finishEditing() {
    setIsEditing(false);

    requestAnimationFrame(() => {
      updateNodeInternals(id);

      requestAnimationFrame(() => {
        requestAutoBalance();
      });
    });
  }

  return (
    <div
      className={[
        "syntax-node",
        `${data.kind}-node`,
        selected
          ? "selected-syntax-node"
          : "",
        isEditing
          ? "editing-syntax-node"
          : "",
        data.isLowerCopy &&
        !isMovementSummary
          ? "condensed-lower-copy-node"
          : "",
        isMovementSummary
          ? "movement-summary-node"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        isMovementSummary
          ? {
              width: summaryWidth,
              minWidth: summaryWidth,
              padding: 0,
              border: 0,
              background:
                "transparent",
              boxShadow: "none",
              overflow: "visible",
            }
          : !showNodeBoxes
            ? {
                width: "max-content",
                minWidth: 0,
                minHeight: 0,
                padding: "1px 3px",
                borderWidth: 0,
                borderColor:
                  "transparent",
                background:
                  "transparent",
                boxShadow: "none",
                lineHeight: 1.1,
              }
            : undefined
      }
      title={
        isMovementSummary
          ? "Condensed lexical content of the lower copy"
          : data.isLowerCopy
            ? "Condensed lower copy left by movement"
            : "Double-click to edit"
      }
      onDoubleClick={(event) => {
        event.stopPropagation();

        if (isLockedMovementNode) {
          return;
        }

        if (!isEditing) {
          saveUndoSnapshot?.();
        }

        setIsEditing(true);
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="syntax-handle"
        style={
          isMovementSummary
            ? {
                opacity: 0,
                pointerEvents:
                  "none",
              }
            : !showNodeBoxes
              ? {
                  width: 1,
                  height: 1,
                  minWidth: 1,
                  minHeight: 1,
                  border: 0,
                  background:
                    "transparent",
                  opacity: 0,
                }
              : undefined
        }
      />

      {isMovementSummary ? (
        <div
          aria-label={`Condensed phrase: ${data.label}`}
          className="movement-summary-content"
        >
          <svg
            aria-hidden="true"
            width="88"
            height="64"
            viewBox="0 0 88 64"
            preserveAspectRatio="none"
            className="movement-summary-triangle"
          >
            <path
              d="M 44 4 L 8 36 L 80 36 Z"
              fill={
                showNodeBoxes
                  ? "rgba(255,255,255,0.92)"
                  : "none"
              }
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <span
            className="movement-summary-word-box"
            style={
              !showNodeBoxes
                ? {
                    borderColor:
                      "transparent",
                    background:
                      "transparent",
                    boxShadow: "none",
                  }
                : undefined
            }
          >
            <span className="movement-summary-words">
              {data.label || "\u00A0"}
            </span>
          </span>
        </div>
      ) : isEditing ? (
        <span
          className="node-edit-wrapper nodrag nowheel"
          onDoubleClick={(event) =>
            event.stopPropagation()
          }
        >
          <span
            className="node-edit-sizer"
            aria-hidden="true"
            style={nodeTextStyle}
          >
            {data.label || "\u00A0"}
          </span>

          <textarea
            className="editable-node-input nodrag nowheel"
            value={data.label}
            aria-label="Edit node label"
            autoFocus
            spellCheck={false}
            rows={Math.max(
              1,
              labelLines.length,
            )}
            style={{
              ...nodeTextStyle,
              width:
                `${Math.max(
                  2,
                  longestLabelLineLength +
                    1,
                )}ch`,
              height:
                `${Math.max(
                  1,
                  labelLines.length,
                ) * 1.2 + 0.45}em`,
              minWidth: "2ch",
              minHeight: "1.65em",
              padding: "1px 2px",
              boxSizing:
                "content-box",
              resize: "none",
              overflow: "hidden",
              fontFamily: "inherit",
              fontSize: "inherit",
              background:
                "transparent",
            }}
            onFocus={(event) => {
              if (
                (
                  data.kind === "word" ||
                  data.kind ===
                    "wordInput"
                ) &&
                data.label === "∅"
              ) {
                event.currentTarget.select();
              }
            }}
            onChange={(event) => {
              reactFlow.updateNodeData(
                id,
                {
                  label:
                    event.target.value,
                },
              );
            }}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              event.stopPropagation();

              const isLexicalInput =
                data.kind === "word" ||
                data.kind ===
                  "wordInput";

              if (
                event.key === "Tab" &&
                isLexicalInput &&
                !data.isLowerCopy
              ) {
                event.preventDefault();

                const nextNodeId =
                  getAdjacentLexicalNodeId(
                    id,
                    reactFlow.getNodes(),
                    reactFlow.getEdges(),
                    event.shiftKey
                      ? -1
                      : 1,
                  );

                if (!nextNodeId) {
                  return;
                }

                event.currentTarget.blur();

                window.setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent<
                      FocusLexicalNodeDetail
                    >(
                      FOCUS_LEXICAL_NODE_EVENT,
                      {
                        detail: {
                          nodeId:
                            nextNodeId,
                        },
                      },
                    ),
                  );
                }, 0);

                return;
              }

              if (
                event.key === "Enter"
              ) {
                if (event.shiftKey) {
                  /*
                   * Shift+Enter inserts a
                   * new line in the label.
                   */
                  return;
                }

                event.preventDefault();
                event.currentTarget.blur();
                return;
              }

              if (
                event.key === "Escape"
              ) {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </span>
      ) : (
        <span
          className="syntax-node-label"
          style={nodeTextStyle}
        >
          {data.label || "\u00A0"}
        </span>
      )}

      {canHaveChildren && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="syntax-handle"
          style={
            !showNodeBoxes
              ? {
                  width: 1,
                  height: 1,
                  minWidth: 1,
                  minHeight: 1,
                  border: 0,
                  background:
                    "transparent",
                  opacity: 0,
                }
              : undefined
          }
        />
      )}

      <Handle
        id="movement-source"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="movement-handle"
        style={{
          width: 1,
          height: 1,
          minWidth: 1,
          minHeight: 1,
          border: 0,
          background: "transparent",
          opacity: 0,
          pointerEvents: "none",
          bottom:
            isMovementSummary
              ? 22
              : undefined,
        }}
      />

      <Handle
        id="movement-target"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className="movement-handle"
        style={{
          width: 1,
          height: 1,
          minWidth: 1,
          minHeight: 1,
          border: 0,
          background: "transparent",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function TreeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
}: EdgeProps) {
  const treePath = [
    `M ${sourceX},${sourceY}`,
    `L ${targetX},${targetY}`,
  ].join(" ");

  return (
    <BaseEdge
      id={id}
      path={treePath}
      markerEnd={markerEnd}
      interactionWidth={16}
      className="tree-edge-path"
      style={{
        stroke: "#20242a",
        strokeWidth:
          TREE_EDGE_STROKE_WIDTH,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        vectorEffect:
          "non-scaling-stroke",
        shapeRendering:
          "geometricPrecision",
      }}
    />
  );
}

function MovementEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
}: EdgeProps) {
  const {
    showMovementArrows,
  } = useContext(
    DisplayOptionsContext,
  );

  const currentNodes =
    useNodes<SyntaxNode>();

  if (!showMovementArrows) {
    return null;
  }

  /*
   * Place the lowest part of every movement
   * arrow beneath the lowest node in the
   * complete canvas.
   */
  const nodeBounds =
    getNodesBounds(currentNodes);

  const bottomClearance = 110;

  const routeY =
    Math.max(
      nodeBounds.y +
        nodeBounds.height +
        bottomClearance,
      sourceY + bottomClearance,
      targetY + bottomClearance,
    );

  /*
   * A single cubic curve leaves the lower
   * copy, passes beneath the complete tree,
   * and rises to the higher copy.
   */
  const movementPath = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX},${routeY}`,
    `${targetX},${routeY}`,
    `${targetX},${targetY}`,
  ].join(" ");

  return (
    <BaseEdge
      id={id}
      path={movementPath}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={18}
      className="movement-edge-path"
    />
  );
}

const edgeTypes = {
  movement: MovementEdge,
  tree: TreeEdge,
};

const nodeTypes = {
  syntaxNode: SyntaxNodeComponent,
};

function PaletteCard({
  item,
  onDragStart,
}: {
  item: PaletteItem;
  onDragStart: (
    event: DragEvent<HTMLButtonElement>,
    item: PaletteItem,
  ) => void;
}) {
  return (
    <button
      type="button"
      className={`palette-card ${item.kind}-palette-card`}
      draggable
      onDragStart={(event) =>
        onDragStart(event, item)
      }
    >
      {item.label}
    </button>
  );
}
function isMovementEdge(
  edge: Edge,
): boolean {
  return (
    edge.data?.edgeKind ===
    "movement"
  );
}

function isHeadToLexicalEdge(
  edge: Edge,
  currentNodes:
    readonly SyntaxNode[],
): boolean {
  if (isMovementEdge(edge)) {
    return false;
  }

  const sourceNode =
    currentNodes.find(
      (node) =>
        node.id === edge.source,
    );

  const targetNode =
    currentNodes.find(
      (node) =>
        node.id === edge.target,
    );

  return (
    sourceNode?.data.kind === "head" &&
    (
      targetNode?.data.kind === "word" ||
      targetNode?.data.kind ===
        "wordInput"
    )
  );
}

interface DeleteSelectionResult {
  nodes: SyntaxNode[];
  edges: Edge[];
  changed: boolean;
}

interface PromotedDaughter {
  nodeId: string;
  boundaryEdge: Edge;
}

interface DeletedRootReplacement {
  incomingEdge: Edge;
  promotedDaughters:
    PromotedDaughter[];
}

function deleteSelectionAndPromoteDaughters(
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
): DeleteSelectionResult {
  const selectedNodeIds =
    new Set(
      currentNodes
        .filter(
          (node) => node.selected,
        )
        .map(
          (node) => node.id,
        ),
    );

  const selectedEdgeIds =
    new Set(
      currentEdges
        .filter(
          (edge) => edge.selected,
        )
        .map(
          (edge) => edge.id,
        ),
    );

  if (
    selectedNodeIds.size === 0 &&
    selectedEdgeIds.size === 0
  ) {
    return {
      nodes: [...currentNodes],
      edges: [...currentEdges],
      changed: false,
    };
  }

  const nodeById =
    new Map(
      currentNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const structuralEdges =
    currentEdges.filter(
      (edge) =>
        !isMovementEdge(edge),
    );

  const incomingEdgeByTarget =
    new Map<string, Edge>();

  const childEdgesByParent =
    new Map<string, Edge[]>();

  for (const edge of structuralEdges) {
    if (
      !incomingEdgeByTarget.has(
        edge.target,
      )
    ) {
      incomingEdgeByTarget.set(
        edge.target,
        edge,
      );
    }

    const childEdges =
      childEdgesByParent.get(
        edge.source,
      ) ?? [];

    childEdgesByParent.set(
      edge.source,
      [
        ...childEdges,
        edge,
      ],
    );
  }

  for (
    const childEdges
    of childEdgesByParent.values()
  ) {
    childEdges.sort(
      (
        firstEdge,
        secondEdge,
      ) => {
        const orderDifference =
          getSiblingOrder(
            firstEdge,
          ) -
          getSiblingOrder(
            secondEdge,
          );

        if (orderDifference !== 0) {
          return orderDifference;
        }

        const firstNode =
          nodeById.get(
            firstEdge.target,
          );

        const secondNode =
          nodeById.get(
            secondEdge.target,
          );

        return (
          (
            firstNode?.position.x ??
            0
          ) -
          (
            secondNode?.position.x ??
            0
          )
        );
      },
    );
  }

  const highestSelectedNodeIds =
    [...selectedNodeIds].filter(
      (nodeId) => {
        const incomingEdge =
          incomingEdgeByTarget.get(
            nodeId,
          );

        return (
          !incomingEdge ||
          !selectedNodeIds.has(
            incomingEdge.source,
          )
        );
      },
    );

  function collectPromotedDaughters(
    selectedRootId: string,
  ): PromotedDaughter[] {
    const promotedDaughters:
      PromotedDaughter[] = [];

    const activeNodeIds =
      new Set<string>();

    function visitSelectedNode(
      nodeId: string,
    ) {
      if (
        activeNodeIds.has(nodeId)
      ) {
        return;
      }

      activeNodeIds.add(nodeId);

      const childEdges =
        childEdgesByParent.get(
          nodeId,
        ) ?? [];

      for (const childEdge of childEdges) {
        if (
          selectedNodeIds.has(
            childEdge.target,
          )
        ) {
          visitSelectedNode(
            childEdge.target,
          );

          continue;
        }

        promotedDaughters.push({
          nodeId:
            childEdge.target,
          boundaryEdge:
            childEdge,
        });
      }

      activeNodeIds.delete(nodeId);
    }

    visitSelectedNode(
      selectedRootId,
    );

    return promotedDaughters;
  }

  const replacementsByParent =
    new Map<
      string,
      DeletedRootReplacement[]
    >();

  for (
    const selectedRootId
    of highestSelectedNodeIds
  ) {
    const incomingEdge =
      incomingEdgeByTarget.get(
        selectedRootId,
      );

    if (!incomingEdge) {
      /*
       * Deleting a root leaves each
       * surviving frontier daughter as
       * an independent root.
       */
      continue;
    }

    const existingReplacements =
      replacementsByParent.get(
        incomingEdge.source,
      ) ?? [];

    replacementsByParent.set(
      incomingEdge.source,
      [
        ...existingReplacements,
        {
          incomingEdge,
          promotedDaughters:
            collectPromotedDaughters(
              selectedRootId,
            ),
        },
      ],
    );
  }

  /*
   * Remove every selected node, every
   * selected edge, and every edge touching
   * a selected node. Movement edges with a
   * deleted endpoint are removed as well.
   */
  let nextEdges =
    currentEdges.filter(
      (edge) =>
        !selectedEdgeIds.has(
          edge.id,
        ) &&
        !selectedNodeIds.has(
          edge.source,
        ) &&
        !selectedNodeIds.has(
          edge.target,
        ),
    );

  /*
   * Rebuild each affected surviving
   * parent's daughter list. A deleted
   * subtree's surviving frontier daughters
   * occupy the same sister position as the
   * highest deleted node.
   */
  for (
    const [
      parentId,
      replacements,
    ]
    of replacementsByParent
  ) {
    const replacementByIncomingEdgeId =
      new Map(
        replacements.map(
          (replacement) => [
            replacement
              .incomingEdge.id,
            replacement,
          ],
        ),
      );

    const originalParentEdges =
      structuralEdges
        .filter(
          (edge) =>
            edge.source ===
              parentId,
        )
        .sort(
          (
            firstEdge,
            secondEdge,
          ) => {
            const orderDifference =
              getSiblingOrder(
                firstEdge,
              ) -
              getSiblingOrder(
                secondEdge,
              );

            if (
              orderDifference !== 0
            ) {
              return orderDifference;
            }

            const firstNode =
              nodeById.get(
                firstEdge.target,
              );

            const secondNode =
              nodeById.get(
                secondEdge.target,
              );

            return (
              (
                firstNode?.position.x ??
                0
              ) -
              (
                secondNode?.position.x ??
                0
              )
            );
          },
        );

    const rebuiltChildEntries:
      Array<{
        nodeId: string;
        edgeTemplate: Edge;
        promoted: boolean;
      }> = [];

    for (
      const originalEdge
      of originalParentEdges
    ) {
      const replacement =
        replacementByIncomingEdgeId.get(
          originalEdge.id,
        );

      if (replacement) {
        for (
          const promotedDaughter
          of replacement
            .promotedDaughters
        ) {
          rebuiltChildEntries.push({
            nodeId:
              promotedDaughter.nodeId,
            edgeTemplate:
              promotedDaughter
                .boundaryEdge,
            promoted: true,
          });
        }

        continue;
      }

      if (
        selectedNodeIds.has(
          originalEdge.target,
        ) ||
        selectedEdgeIds.has(
          originalEdge.id,
        )
      ) {
        continue;
      }

      rebuiltChildEntries.push({
        nodeId:
          originalEdge.target,
        edgeTemplate:
          originalEdge,
        promoted: false,
      });
    }

    nextEdges =
      nextEdges.filter(
        (edge) =>
          isMovementEdge(edge) ||
          edge.source !== parentId,
      );

    rebuiltChildEntries.forEach(
      (
        childEntry,
        siblingOrder,
      ) => {
        if (childEntry.promoted) {
          nextEdges.push({
            id:
              `promoted-${parentId}-${childEntry.nodeId}-${siblingOrder}`,
            source:
              parentId,
            target:
              childEntry.nodeId,
            type:
              childEntry
                .edgeTemplate.type ??
              "straight",
            targetHandle:
              childEntry
                .edgeTemplate
                .targetHandle,
            hidden:
              Boolean(
                childEntry
                  .edgeTemplate.hidden,
              ),
            style:
              childEntry
                .edgeTemplate.style,
            data: {
              edgeKind: "tree",
              siblingOrder,
            },
          });

          return;
        }

        nextEdges.push({
          ...childEntry.edgeTemplate,
          selected: false,
          data: {
            ...childEntry
              .edgeTemplate.data,
            edgeKind:
              childEntry
                .edgeTemplate.data
                ?.edgeKind ??
              "tree",
            siblingOrder,
          },
        });
      },
    );
  }

  const nextNodes =
    currentNodes
      .filter(
        (node) =>
          !selectedNodeIds.has(
            node.id,
          ),
      )
      .map(
        (node): SyntaxNode => ({
          ...node,
          selected: false,
          dragging: false,
        }),
      );

  nextEdges = nextEdges.map(
    (edge): Edge => ({
      ...edge,
      selected: false,
    }),
  );

  return {
    nodes: nextNodes,
    edges: nextEdges,
    changed: true,
  };
}

function getStructuralDescendantIds(
  rootNodeId: string,
  currentEdges: readonly Edge[],
): Set<string> {
  const descendantIds =
    new Set<string>([
      rootNodeId,
    ]);

  const nodesToCheck = [
    rootNodeId,
  ];

  while (nodesToCheck.length > 0) {
    const currentNodeId =
      nodesToCheck.pop();

    if (!currentNodeId) {
      continue;
    }

    const childEdges =
      currentEdges.filter(
        (edge) =>
          !isMovementEdge(edge) &&
          edge.source ===
            currentNodeId,
      );

    for (const edge of childEdges) {
      if (
        descendantIds.has(
          edge.target,
        )
      ) {
        continue;
      }

      descendantIds.add(
        edge.target,
      );

      nodesToCheck.push(
        edge.target,
      );
    }
  }

  return descendantIds;
}

function getLexicalHeadTerminalId(
  rootNodeId: string,
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
): string | null {
  const nodeById =
    new Map(
      currentNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const childIdsByParent =
    new Map<string, string[]>();

  for (const edge of currentEdges) {
    if (isMovementEdge(edge)) {
      continue;
    }

    const childIds =
      childIdsByParent.get(
        edge.source,
      ) ?? [];

    childIdsByParent.set(
      edge.source,
      [
        ...childIds,
        edge.target,
      ],
    );
  }

  const visitedNodeIds =
    new Set<string>();

  function followHeadProjection(
    nodeId: string,
  ): string | null {
    if (
      visitedNodeIds.has(nodeId)
    ) {
      return null;
    }

    visitedNodeIds.add(nodeId);

    const node =
      nodeById.get(nodeId);

    if (!node) {
      return null;
    }

    const childIds =
      childIdsByParent.get(
        nodeId,
      ) ?? [];

    const childNodes =
      childIds
        .map((childId) =>
          nodeById.get(childId),
        )
        .filter(
          (
            childNode,
          ): childNode is SyntaxNode =>
            Boolean(childNode),
        );

    /*
     * A lexical head such as N, V, or T
     * normally dominates the terminal word.
     */
    if (node.data.kind === "head") {
      const lexicalChild =
        childNodes.find(
          (childNode) =>
            childNode.data.kind ===
              "word" ||
            childNode.data.kind ===
              "wordInput",
        );

      if (lexicalChild) {
        return lexicalChild.id;
      }
    }

    /*
     * Prefer the direct head daughter of
     * a bar level, such as N under N′.
     */
    const directHeadChild =
      childNodes.find(
        (childNode) =>
          childNode.data.kind ===
          "head",
      );

    if (directHeadChild) {
      const terminalId =
        followHeadProjection(
          directHeadChild.id,
        );

      if (terminalId) {
        return terminalId;
      }
    }

    /*
     * With adjunction, the lower bar has
     * the same label as the upper bar.
     */
    const repeatedBarChild =
      childNodes.find(
        (childNode) =>
          childNode.data.kind ===
            "phrase" &&
          childNode.data.label ===
            node.data.label,
      );

    if (repeatedBarChild) {
      const terminalId =
        followHeadProjection(
          repeatedBarChild.id,
        );

      if (terminalId) {
        return terminalId;
      }
    }

    /*
     * A maximal projection normally
     * dominates its corresponding X′.
     */
    const barLevelChild =
      childNodes.find(
        (childNode) =>
          childNode.data.kind ===
            "phrase" &&
          isBarLevelLabel(
            childNode.data.label,
          ),
      );

    if (barLevelChild) {
      const terminalId =
        followHeadProjection(
          barLevelChild.id,
        );

      if (terminalId) {
        return terminalId;
      }
    }

    /*
     * Fallback for edited or nonstandard
     * labels: search the remaining branches.
     */
    for (const childNode of childNodes) {
      const terminalId =
        followHeadProjection(
          childNode.id,
        );

      if (terminalId) {
        return terminalId;
      }
    }

    if (
      node.data.kind === "word" ||
      node.data.kind === "wordInput"
    ) {
      return node.id;
    }

    return null;
  }

  return followHeadProjection(
    rootNodeId,
  );
}

function getLexicalYield(
  rootNodeId: string,
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
): string {
  const nodeById =
    new Map(
      currentNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const childEdgesByParent =
    new Map<string, Edge[]>();

  for (const edge of currentEdges) {
    if (isMovementEdge(edge)) {
      continue;
    }

    const childEdges =
      childEdgesByParent.get(
        edge.source,
      ) ?? [];

    childEdgesByParent.set(
      edge.source,
      [
        ...childEdges,
        edge,
      ],
    );
  }

  for (
    const childEdges
    of childEdgesByParent.values()
  ) {
    childEdges.sort(
      (firstEdge, secondEdge) => {
        const orderDifference =
          getSiblingOrder(
            firstEdge,
          ) -
          getSiblingOrder(
            secondEdge,
          );

        if (orderDifference !== 0) {
          return orderDifference;
        }

        const firstChild =
          nodeById.get(
            firstEdge.target,
          );

        const secondChild =
          nodeById.get(
            secondEdge.target,
          );

        return (
          (
            firstChild?.position.x ??
            0
          ) -
          (
            secondChild?.position.x ??
            0
          )
        );
      },
    );
  }

  const lexicalWords: string[] = [];
  const activeNodeIds =
    new Set<string>();

  function collectWords(
    nodeId: string,
  ) {
    if (
      activeNodeIds.has(nodeId)
    ) {
      return;
    }

    activeNodeIds.add(nodeId);

    const node =
      nodeById.get(nodeId);

    if (!node) {
      activeNodeIds.delete(nodeId);
      return;
    }

    if (
      node.data.kind === "word" ||
      node.data.kind === "wordInput"
    ) {
      const word =
        node.data.label.trim();

      if (word) {
        lexicalWords.push(word);
      }

      activeNodeIds.delete(nodeId);
      return;
    }

    if (
      node.data.kind ===
      "movementSummary"
    ) {
      const words =
        node.data.label.trim();

      if (words) {
        lexicalWords.push(words);
      }

      activeNodeIds.delete(nodeId);
      return;
    }

    const childEdges =
      childEdgesByParent.get(
        nodeId,
      ) ?? [];

    for (const edge of childEdges) {
      collectWords(edge.target);
    }

    activeNodeIds.delete(nodeId);
  }

  collectWords(rootNodeId);

  return lexicalWords.join(" ");
}

function wouldCreateCycle(
  parentId: string,
  childId: string,
  currentEdges: readonly Edge[],
): boolean {
  if (parentId === childId) {
    return true;
  }

  const nodesToCheck = [childId];
  const visitedNodes = new Set<string>();

  while (nodesToCheck.length > 0) {
    const currentNodeId = nodesToCheck.pop();

    if (!currentNodeId) {
      continue;
    }

    if (visitedNodes.has(currentNodeId)) {
      continue;
    }

    visitedNodes.add(currentNodeId);

    const childEdges =
  currentEdges.filter(
    (edge) =>
      !isMovementEdge(edge) &&
      edge.source ===
        currentNodeId,
  );

    for (const edge of childEdges) {
      if (edge.target === parentId) {
        return true;
      }

      nodesToCheck.push(edge.target);
    }
  }

  return false;
}

const SISTER_GAP = 36;
const LEVEL_GAP = 55;

/*
 * Boxless mode uses substantially less
 * space because the branch lines attach
 * directly beside the visible labels.
 */
const BOXLESS_SISTER_GAP = 24;
const BOXLESS_LEVEL_GAP = 42;

/*
 * The condensed-copy triangle is positioned
 * 54 pixels above its React Flow node.
 * This value places the triangle apex exactly
 * against the bottom of its phrase parent.
 */
const MOVEMENT_SUMMARY_APEX_OFFSET = 54;

/*
 * Every ordinary structural branch is
 * rendered by the same custom edge component.
 * vectorEffect keeps this width constant when
 * React Flow zooms or PNG export transforms
 * the SVG viewport.
 */
const TREE_EDGE_STROKE_WIDTH = 2;

function getSyntaxNodeWidth(
  node: SyntaxNode,
): number {
  if (node.measured?.width) {
    return node.measured.width;
  }

  const labelLines =
    node.data.label
      .replace(/\r\n?/g, "\n")
      .split("\n");

  const characterCount =
    Math.max(
      1,
      ...labelLines.map(
        (line) =>
          Array.from(line).length,
      ),
    );

  if (
    node.data.kind ===
    "movementSummary"
  ) {
    return Math.max(
      120,
      characterCount * 9 + 30,
    );
  }

  const approximateCharacterWidth =
    node.data.kind === "word" ||
    node.data.kind === "wordInput"
      ? 9
      : 10;

  return Math.max(
    44,
    characterCount *
      approximateCharacterWidth +
      24,
  );
}

interface CollapsedBarStructure {
  nodes: SyntaxNode[];
  edges: Edge[];
  collapsedNodeIds: Set<string>;
}

function createCollapsedBarStructure(
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
  collapseUnusedBarLevels: boolean,
): CollapsedBarStructure {
  if (!collapseUnusedBarLevels) {
    return {
      nodes: [...currentNodes],
      edges: [...currentEdges],
      collapsedNodeIds:
        new Set<string>(),
    };
  }

  const nodeById =
    new Map(
      currentNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const visibleNodeIds =
    new Set(
      currentNodes.map(
        (node) => node.id,
      ),
    );

  const collapsedNodeIds =
    new Set<string>();

  let effectiveEdges =
    currentEdges.map(
      (edge): Edge => ({
        ...edge,
        data: edge.data
          ? {
              ...edge.data,
            }
          : undefined,
      }),
    );

  /*
   * Contract one eligible unary bar at a
   * time, then recalculate the graph. This
   * also handles chains of unused bar levels.
   */
  let structureChanged = true;

  while (structureChanged) {
    structureChanged = false;

    const structuralEdges =
      effectiveEdges.filter(
        (edge) =>
          !isMovementEdge(edge) &&
          visibleNodeIds.has(
            edge.source,
          ) &&
          visibleNodeIds.has(
            edge.target,
          ),
      );

    const movementEndpointIds =
      new Set<string>();

    for (const edge of effectiveEdges) {
      if (!isMovementEdge(edge)) {
        continue;
      }

      movementEndpointIds.add(
        edge.source,
      );

      movementEndpointIds.add(
        edge.target,
      );
    }

    for (const nodeId of [
      ...visibleNodeIds,
    ]) {
      const node =
        nodeById.get(nodeId);

      if (
        !node ||
        node.data.kind !== "phrase" ||
        !isBarLevelLabel(
          node.data.label,
        ) ||
        node.data.isLowerCopy ||
        movementEndpointIds.has(nodeId)
      ) {
        continue;
      }

      const incomingEdges =
        structuralEdges.filter(
          (edge) =>
            edge.target === nodeId,
        );

      const outgoingEdges =
        structuralEdges
          .filter(
            (edge) =>
              edge.source === nodeId,
          )
          .sort(
            (
              firstEdge,
              secondEdge,
            ) =>
              getSiblingOrder(
                firstEdge,
              ) -
              getSiblingOrder(
                secondEdge,
              ),
          );

      /*
       * The bar must have one structural
       * parent and at least one daughter.
       * Root bar levels are retained because
       * there is no parent to receive the
       * promoted daughters.
       */
      if (
        incomingEdges.length !== 1 ||
        outgoingEdges.length === 0
      ) {
        continue;
      }

      const incomingEdge =
        incomingEdges[0];

      const parentOutgoingEdges =
        structuralEdges.filter(
          (edge) =>
            edge.source ===
              incomingEdge.source,
        );

      const hasOneDaughter =
        outgoingEdges.length === 1;

      const isOnlyDaughterOfParent =
        parentOutgoingEdges.length === 1;

      /*
       * Collapse the X′ level when either:
       *
       * 1. the X′ itself has one daughter; or
       * 2. the X′ is the only daughter of its
       *    parent, even when the X′ has two
       *    or more daughters.
       */
      if (
        !hasOneDaughter &&
        !isOnlyDaughterOfParent
      ) {
        continue;
      }

      const createsInvalidLoop =
        outgoingEdges.some(
          (outgoingEdge) =>
            incomingEdge.source ===
              outgoingEdge.target ||
            incomingEdge.source ===
              nodeId ||
            outgoingEdge.target ===
              nodeId,
        );

      if (createsInvalidLoop) {
        continue;
      }

      /*
       * Promote every daughter to the removed
       * bar level's parent. When there is only
       * one daughter, it inherits the bar's
       * former sister position. When the bar
       * was the parent's only daughter, its
       * daughters retain their internal order.
       */
      const bypassEdges =
        outgoingEdges.map(
          (
            outgoingEdge,
            daughterIndex,
          ): Edge => ({
            id:
              `collapsed-${incomingEdge.id}-${outgoingEdge.id}`,
            source:
              incomingEdge.source,
            target:
              outgoingEdge.target,
            type:
              incomingEdge.type ??
              outgoingEdge.type ??
              "straight",
            sourceHandle:
              incomingEdge.sourceHandle,
            targetHandle:
              outgoingEdge.targetHandle,
            hidden:
              Boolean(
                incomingEdge.hidden,
              ) &&
              Boolean(
                outgoingEdge.hidden,
              ),
            style:
              outgoingEdge.style ??
              incomingEdge.style,
            data: {
              ...incomingEdge.data,
              edgeKind: "tree",
              siblingOrder:
                hasOneDaughter
                  ? getSiblingOrder(
                      incomingEdge,
                    )
                  : daughterIndex,
              collapsedBarNodeId:
                nodeId,
            },
          }),
        );

      const removedEdgeIds =
        new Set([
          incomingEdge.id,
          ...outgoingEdges.map(
            (edge) => edge.id,
          ),
        ]);

      effectiveEdges = [
        ...effectiveEdges.filter(
          (edge) =>
            !removedEdgeIds.has(
              edge.id,
            ),
        ),
        ...bypassEdges,
      ];

      visibleNodeIds.delete(nodeId);

      collapsedNodeIds.add(nodeId);

      structureChanged = true;
      break;
    }
  }

  return {
    nodes:
      currentNodes.filter(
        (node) =>
          visibleNodeIds.has(
            node.id,
          ),
      ),
    edges:
      effectiveEdges.filter(
        (edge) =>
          visibleNodeIds.has(
            edge.source,
          ) &&
          visibleNodeIds.has(
            edge.target,
          ),
      ),
    collapsedNodeIds,
  };
}

function getSiblingOrder(
  edge: Edge,
): number {
  const siblingOrder =
    edge.data?.siblingOrder;

  return typeof siblingOrder === "number"
    ? siblingOrder
    : 0;
}

/*
 * Finds all nodes belonging to the same connected
 * tree as the selected node.
 */
function getConnectedNodeIds(
  startingNodeId: string,
  currentEdges: readonly Edge[],
): Set<string> {
  const connections = new Map<
    string,
    string[]
  >();

  function addConnection(
    firstId: string,
    secondId: string,
  ) {
    const existingConnections =
      connections.get(firstId) ?? [];

    connections.set(firstId, [
      ...existingConnections,
      secondId,
    ]);
  }

  for (const edge of currentEdges) {
    addConnection(
      edge.source,
      edge.target,
    );

    addConnection(
      edge.target,
      edge.source,
    );
  }

  const connectedNodeIds =
    new Set<string>();

  const nodesToCheck = [
    startingNodeId,
  ];

  while (nodesToCheck.length > 0) {
    const currentNodeId =
      nodesToCheck.pop();

    if (!currentNodeId) {
      continue;
    }

    if (
      connectedNodeIds.has(
        currentNodeId,
      )
    ) {
      continue;
    }

    connectedNodeIds.add(
      currentNodeId,
    );

    const neighbouringNodeIds =
      connections.get(currentNodeId) ??
      [];

    for (
      const neighbouringNodeId
      of neighbouringNodeIds
    ) {
      nodesToCheck.push(
        neighbouringNodeId,
      );
    }
  }

  return connectedNodeIds;
}

/*
 * Automatically positions one connected tree.
 *
 * Sisters receive equally sized horizontal slots.
 * All nodes at the same depth receive the same
 * vertical position.
 */
function layoutTreeComponent(
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
  startingNodeId: string,
  showNodeBoxes = true,
  showHeadWordLines = true,
  treeLayoutMode:
    TreeLayoutMode = "topDown",
  collapseUnusedBarLevels = false,
): SyntaxNode[] {
  const activeSisterGap =
    showNodeBoxes
      ? SISTER_GAP
      : BOXLESS_SISTER_GAP;

  const activeLevelGap =
    showNodeBoxes
      ? LEVEL_GAP
      : BOXLESS_LEVEL_GAP;

  const collapsedStructure =
    createCollapsedBarStructure(
      currentNodes,
      currentEdges,
      collapseUnusedBarLevels,
    );

  const layoutNodes =
    collapsedStructure.nodes;

  const layoutEdges =
    collapsedStructure.edges;

  const structuralEdges =
    layoutEdges.filter(
      (edge) =>
        !isMovementEdge(edge),
    );

  const nodeById = new Map(
    layoutNodes.map((node) => [
      node.id,
      node,
    ]),
  );

  const effectiveStartingNodeId =
    nodeById.has(startingNodeId)
      ? startingNodeId
      : (
          layoutNodes.find(
            (node) => {
              const originalConnectedIds =
                getConnectedNodeIds(
                  startingNodeId,
                  currentEdges.filter(
                    (edge) =>
                      !isMovementEdge(
                        edge,
                      ),
                  ),
                );

              return originalConnectedIds
                .has(node.id);
            },
          )?.id ??
          layoutNodes[0]?.id ??
          startingNodeId
        );

  const connectedNodeIds =
    getConnectedNodeIds(
      effectiveStartingNodeId,
      structuralEdges,
    );

  const childEdgesByParent =
    new Map<string, Edge[]>();

  for (const edge of structuralEdges) {
    if (
      !connectedNodeIds.has(
        edge.source,
      ) ||
      !connectedNodeIds.has(
        edge.target,
      )
    ) {
      continue;
    }

    const currentChildEdges =
      childEdgesByParent.get(
        edge.source,
      ) ?? [];

    childEdgesByParent.set(
      edge.source,
      [
        ...currentChildEdges,
        edge,
      ],
    );
  }

  /*
   * Sort daughters first by their saved
   * sibling order, then by their current
   * horizontal position.
   */
  for (
    const childEdges
    of childEdgesByParent.values()
  ) {
    childEdges.sort(
      (firstEdge, secondEdge) => {
        const orderDifference =
          getSiblingOrder(firstEdge) -
          getSiblingOrder(secondEdge);

        if (orderDifference !== 0) {
          return orderDifference;
        }

        const firstNode =
          nodeById.get(
            firstEdge.target,
          );

        const secondNode =
          nodeById.get(
            secondEdge.target,
          );

        return (
          (firstNode?.position.x ?? 0) -
          (secondNode?.position.x ?? 0)
        );
      },
    );
  }

  function getChildIds(
    parentId: string,
  ): string[] {
    return (
      childEdgesByParent.get(
        parentId,
      ) ?? []
    ).map((edge) => edge.target);
  }

  /*
   * Find the root: the connected node
   * that has no incoming edge.
   */
  const nodesWithParents =
    new Set<string>();

  for (const edge of structuralEdges) {
    if (
      connectedNodeIds.has(
        edge.source,
      ) &&
      connectedNodeIds.has(
        edge.target,
      )
    ) {
      nodesWithParents.add(
        edge.target,
      );
    }
  }

  const possibleRootIds = [
    ...connectedNodeIds,
  ].filter(
    (nodeId) =>
      nodeById.has(nodeId) &&
      !nodesWithParents.has(nodeId),
  );

  if (
    possibleRootIds.length === 0
  ) {
    return [...currentNodes];
  }

  /*
   * Normally there is only one root.
   * This sorting provides a safe fallback.
   */
  possibleRootIds.sort(
    (firstId, secondId) => {
      const firstNode =
        nodeById.get(firstId);

      const secondNode =
        nodeById.get(secondId);

      const verticalDifference =
        (firstNode?.position.y ?? 0) -
        (secondNode?.position.y ?? 0);

      if (
        verticalDifference !== 0
      ) {
        return verticalDifference;
      }

      return (
        (firstNode?.position.x ?? 0) -
        (secondNode?.position.x ?? 0)
      );
    },
  );

  const rootId =
    possibleRootIds[0];

  const rootNode =
    nodeById.get(rootId);

  if (!rootNode) {
    return [...currentNodes];
  }

  /*
   * Calculate how much horizontal space
   * each subtree requires.
   */
  const subtreeSpanCache =
    new Map<string, number>();

  const nodesBeingMeasured =
    new Set<string>();

  function calculateSubtreeSpan(
    nodeId: string,
  ): number {
    const cachedSpan =
      subtreeSpanCache.get(nodeId);

    if (cachedSpan !== undefined) {
      return cachedSpan;
    }

    const node = nodeById.get(nodeId);

    if (!node) {
      return 0;
    }

    /*
     * Defensive protection against an
     * accidental circular structure.
     */
    if (
      nodesBeingMeasured.has(nodeId)
    ) {
      return getSyntaxNodeWidth(node);
    }

    nodesBeingMeasured.add(nodeId);

    const nodeWidth =
      getSyntaxNodeWidth(node);

    const childIds =
      getChildIds(nodeId);

    let subtreeSpan = nodeWidth;

    if (childIds.length > 0) {
  const childSpans =
    childIds.map(
      calculateSubtreeSpan,
    );

  const completeChildrenWidth =
    childSpans.reduce(
      (total, span) =>
        total + span,
      0,
    ) +
    (childIds.length - 1) *
      activeSisterGap;

  subtreeSpan = Math.max(
    nodeWidth,
    completeChildrenWidth,
  );
}

    nodesBeingMeasured.delete(
      nodeId,
    );

    subtreeSpanCache.set(
      nodeId,
      subtreeSpan,
    );

    return subtreeSpan;
  }

  calculateSubtreeSpan(rootId);

  function getMeasuredNodeHeight(
    node: SyntaxNode,
  ): number {
    return (
      node.measured?.height ??
      (
        showNodeBoxes
          ? 40
          : 20
      )
    );
  }

  function getParentChildGap(
    parentNode: SyntaxNode,
    childNode: SyntaxNode,
  ): number {
    if (
      childNode.data.kind ===
      "movementSummary"
    ) {
      return (
        getMeasuredNodeHeight(
          parentNode,
        ) +
        MOVEMENT_SUMMARY_APEX_OFFSET
      );
    }

    const isHeadToLexicalChild =
      parentNode.data.kind ===
        "head" &&
      (
        childNode.data.kind ===
          "word" ||
        childNode.data.kind ===
          "wordInput"
      );

    if (
      !showHeadWordLines &&
      isHeadToLexicalChild
    ) {
      return (
        getMeasuredNodeHeight(
          parentNode,
        ) +
        (
          showNodeBoxes
            ? 8
            : 3
        )
      );
    }

    return activeLevelGap;
  }

  /*
   * Bottom-up layout measures each node
   * upward from the shared terminal row.
   * Every lexical word therefore receives
   * the same y coordinate. Shorter branches
   * begin lower, producing the intended
   * staggered construction from the words.
   */
  const terminalDistanceCache =
    new Map<string, number>();

  const nodesBeingRanked =
    new Set<string>();

  function calculateDistanceToTerminal(
    nodeId: string,
  ): number {
    const cachedDistance =
      terminalDistanceCache.get(
        nodeId,
      );

    if (
      cachedDistance !== undefined
    ) {
      return cachedDistance;
    }

    const node =
      nodeById.get(nodeId);

    if (!node) {
      return 0;
    }

    if (
      nodesBeingRanked.has(nodeId)
    ) {
      return 0;
    }

    const childIds =
      getChildIds(nodeId);

    const isTerminalNode =
      node.data.kind === "word" ||
      node.data.kind ===
        "wordInput" ||
      node.data.kind ===
        "movementSummary" ||
      childIds.length === 0;

    if (isTerminalNode) {
      terminalDistanceCache.set(
        nodeId,
        0,
      );

      return 0;
    }

    nodesBeingRanked.add(nodeId);

    const distance =
      Math.max(
        ...childIds.map(
          (childId) => {
            const childNode =
              nodeById.get(childId);

            if (!childNode) {
              return 0;
            }

            return (
              getParentChildGap(
                node,
                childNode,
              ) +
              calculateDistanceToTerminal(
                childId,
              )
            );
          },
        ),
      );

    nodesBeingRanked.delete(nodeId);

    terminalDistanceCache.set(
      nodeId,
      distance,
    );

    return distance;
  }

  const bottomUpTerminalY =
    rootNode.position.y +
    calculateDistanceToTerminal(
      rootId,
    );

  const newPositions =
    new Map<
      string,
      {
        x: number;
        y: number;
      }
    >();

  function placeSubtree(
    nodeId: string,
    centreX: number,
    y: number,
  ) {
    const node = nodeById.get(nodeId);

    if (!node) {
      return;
    }

    const nodeWidth =
      getSyntaxNodeWidth(node);

    const nodeY =
      treeLayoutMode === "bottomUp"
        ? bottomUpTerminalY -
          calculateDistanceToTerminal(
            nodeId,
          )
        : y;

    newPositions.set(nodeId, {
      x: centreX - nodeWidth / 2,
      y: nodeY,
    });

    const childIds =
      getChildIds(nodeId);

    if (childIds.length === 0) {
      return;
    }

    const childSpans =
  childIds.map(
    calculateSubtreeSpan,
  );

const completeChildrenWidth =
  childSpans.reduce(
    (total, span) =>
      total + span,
    0,
  ) +
  (childIds.length - 1) *
    activeSisterGap;

/*
 * Begin at the left edge of the complete
 * group of daughter subtrees.
 */
let nextChildLeft =
  centreX -
  completeChildrenWidth / 2;

childIds.forEach(
  (childId, index) => {
    const childSpan =
      childSpans[index];

    const childCentreX =
      nextChildLeft +
      childSpan / 2;

    const childNode =
      nodeById.get(childId);

    const childY =
      childNode
        ? (
            treeLayoutMode ===
              "bottomUp"
              ? bottomUpTerminalY -
                calculateDistanceToTerminal(
                  childId,
                )
              : nodeY +
                getParentChildGap(
                  node,
                  childNode,
                )
          )
        : nodeY + activeLevelGap;

    placeSubtree(
      childId,
      childCentreX,
      childY,
    );

    nextChildLeft +=
      childSpan +
      activeSisterGap;
  },
);
  }

  /*
   * Keep the root approximately where
   * it was before balancing.
   */
  const rootCentreX =
    rootNode.position.x +
    getSyntaxNodeWidth(rootNode) / 2;

  placeSubtree(
    rootId,
    rootCentreX,
    rootNode.position.y,
  );

  return currentNodes.map((node) => {
    const newPosition =
      newPositions.get(node.id);

    if (!newPosition) {
      return node;
    }

    return {
      ...node,
      position: newPosition,
    };
  });
}
function layoutAllTreeComponents(
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
  showNodeBoxes: boolean,
  showHeadWordLines: boolean,
  treeLayoutMode: TreeLayoutMode,
  collapseUnusedBarLevels: boolean,
): SyntaxNode[] {
  if (currentNodes.length === 0) {
    return [];
  }

  const collapsedStructure =
    createCollapsedBarStructure(
      currentNodes,
      currentEdges,
      collapseUnusedBarLevels,
    );

  const layoutNodes =
    collapsedStructure.nodes;

  const layoutEdges =
    collapsedStructure.edges;

  const structuralEdges =
    layoutEdges.filter(
      (edge) =>
        !isMovementEdge(edge),
    );

  const nodeIdsWithParents =
    new Set(
      structuralEdges.map(
        (edge) => edge.target,
      ),
    );

  const rootNodes =
    layoutNodes
      .filter(
        (node) =>
          !nodeIdsWithParents.has(
            node.id,
          ),
      )
      .sort(
        (
          firstNode,
          secondNode,
        ) => {
          const verticalDifference =
            firstNode.position.y -
            secondNode.position.y;

          if (
            verticalDifference !== 0
          ) {
            return verticalDifference;
          }

          return (
            firstNode.position.x -
            secondNode.position.x
          );
        },
      );

  let balancedVisibleNodes = [
    ...layoutNodes,
  ];

  for (const rootNode of rootNodes) {
    balancedVisibleNodes =
      layoutTreeComponent(
        balancedVisibleNodes,
        layoutEdges,
        rootNode.id,
        showNodeBoxes,
        showHeadWordLines,
        treeLayoutMode,
        false,
      );
  }

  const balancedNodeById =
    new Map(
      balancedVisibleNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  return currentNodes.map((node) => {
    const balancedNode =
      balancedNodeById.get(
        node.id,
      );

    return balancedNode ?? node;
  });
}

function nodePositionsChanged(
  currentNodes: readonly SyntaxNode[],
  nextNodes: readonly SyntaxNode[],
): boolean {
  const currentNodeById =
    new Map(
      currentNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  for (const nextNode of nextNodes) {
    const currentNode =
      currentNodeById.get(
        nextNode.id,
      );

    if (!currentNode) {
      return true;
    }

    if (
      Math.abs(
        currentNode.position.x -
        nextNode.position.x,
      ) > 0.25 ||
      Math.abs(
        currentNode.position.y -
        nextNode.position.y,
      ) > 0.25
    ) {
      return true;
    }
  }

  return false;
}

interface PendingBarAttachment {
  parentId: string;
  draggedId: string;
  placeOnLeft: boolean;
  draggedPosition: {
    x: number;
    y: number;
  };
}

type BarAttachmentShortcut =
  | "complement"
  | "adjunct"
  | null;

function getBarAttachmentShortcut(
  event: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  },
): BarAttachmentShortcut {
  /*
   * Alt takes precedence when more than
   * one modifier is held.
   */
  if (event.altKey) {
    return "adjunct";
  }

  if (
    event.ctrlKey ||
    event.metaKey
  ) {
    return "complement";
  }

  return null;
}

function isBarLevelLabel(
  label: string,
): boolean {
  return /(?:′|')$/.test(
    label.trim(),
  );
}
function downloadDataUrl(
  dataUrl: string,
  filename: string,
) {
  const link =
    document.createElement("a");

  link.download = filename;
  link.href = dataUrl;
  link.click();
}

function downloadTextFile(
  contents: string,
  filename: string,
) {
  const blob = new Blob(
    [contents],
    {
      type: "text/plain;charset=utf-8",
    },
  );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.download = filename;
  link.href = url;
  link.click();

  URL.revokeObjectURL(url);
}

function escapeLatexText(
  value: string,
): string {
  const replacements: Record<
    string,
    string
  > = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "#": "\\#",
    "$": "\\$",
    "%": "\\%",
    "&": "\\&",
    "_": "\\_",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}",
    "∅": "\\ensuremath{\\varnothing}",
  };

  return Array.from(value)
    .map(
      (character) =>
        replacements[character] ??
        character,
    )
    .join("");
}

function formatLatexLabelLine(
  line: string,
): string {
  const trimmedLine =
    line.trim();

  if (!trimmedLine) {
    return "\\strut";
  }

  const primeMatch =
    trimmedLine.match(
      /^(.*?)[′']$/u,
    );

  if (
    primeMatch &&
    primeMatch[1]
  ) {
    return `${escapeLatexText(
      primeMatch[1],
    )}$'$`;
  }

  return escapeLatexText(
    trimmedLine,
  );
}

function formatLatexNodeLabel(
  label: string,
  data: SyntaxNodeData,
): string {
  const lines =
    label
      .replace(/\r\n?/g, "\n")
      .split("\n");

  const formattedLines =
    lines.map((line) => {
      let formattedLine =
        formatLatexLabelLine(
          line,
        );

      if (isNodeTextBold(data)) {
        formattedLine =
          `\\textbf{${formattedLine}}`;
      }

      if (data.textItalic) {
        formattedLine =
          `\\textit{${formattedLine}}`;
      }

      if (
        data.textStrikethrough
      ) {
        formattedLine =
          `\\sout{${formattedLine}}`;
      }

      return formattedLine;
    });

  if (formattedLines.length === 1) {
    return formattedLines[0];
  }

  return `\\shortstack{${formattedLines.join(
    "\\\\",
  )}}`;
}

function getLatexNodeName(
  nodeId: string,
): string {
  return `n${nodeId.replace(
    /[^A-Za-z0-9]/g,
    "",
  )}`;
}

function formatLatexNumber(
  value: number,
): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value
    .toFixed(3)
    .replace(
      /\.?0+$/,
      "",
    );
}

function createLatexDocument(
  currentNodes:
    readonly SyntaxNode[],
  currentEdges:
    readonly Edge[],
  showNodeBoxes: boolean,
  showMovementArrows: boolean,
  showHeadWordLines: boolean,
): string {
  if (
    currentNodes.length === 0
  ) {
    throw new Error(
      "The canvas does not contain any nodes.",
    );
  }

  const nodeById = new Map(
    currentNodes.map((node) => [
      node.id,
      node,
    ]),
  );

  const structuralEdges =
    currentEdges.filter(
      (edge) =>
        !isMovementEdge(edge),
    );

  const movementEdges =
    currentEdges.filter(
      (edge) =>
        isMovementEdge(edge) &&
        nodeById.has(edge.source) &&
        nodeById.has(edge.target),
    );

  const normalNodes =
    currentNodes.filter(
      (node) =>
        node.data.kind !==
        "movementSummary",
    );

  const positionReferenceNodes =
    normalNodes.length > 0
      ? normalNodes
      : currentNodes;

  const coordinateScale = 0.025;

  function getNodeWidth(
    node: SyntaxNode,
  ): number {
    return (
      node.measured?.width ??
      getSyntaxNodeWidth(node)
    );
  }

  function getNodeHeight(
    node: SyntaxNode,
  ): number {
    return node.measured?.height ?? 40;
  }

  function getNodeCentreX(
    node: SyntaxNode,
  ): number {
    return (
      node.position.x +
      getNodeWidth(node) / 2
    );
  }

  function getNodeCentreY(
    node: SyntaxNode,
  ): number {
    return (
      node.position.y +
      getNodeHeight(node) / 2
    );
  }

  const minimumCentreX =
    Math.min(
      ...positionReferenceNodes.map(
        getNodeCentreX,
      ),
    );

  const minimumCentreY =
    Math.min(
      ...positionReferenceNodes.map(
        getNodeCentreY,
      ),
    );

  function getLatexX(
    node: SyntaxNode,
  ): number {
    return (
      getNodeCentreX(node) -
      minimumCentreX
    ) * coordinateScale;
  }

  function getLatexY(
    node: SyntaxNode,
  ): number {
    return -(
      getNodeCentreY(node) -
      minimumCentreY
    ) * coordinateScale;
  }

  function getSummaryParentEdge(
    summaryNodeId: string,
  ): Edge | undefined {
    return structuralEdges.find(
      (edge) =>
        edge.target ===
          summaryNodeId &&
        nodeById.has(edge.source),
    );
  }

  function getExportXByNodeId(
    nodeId: string,
  ): number {
    const node =
      nodeById.get(nodeId);

    if (!node) {
      return 0;
    }

    if (
      node.data.kind ===
      "movementSummary"
    ) {
      const parentEdge =
        getSummaryParentEdge(
          node.id,
        );

      const parentNode =
        parentEdge
          ? nodeById.get(
              parentEdge.source,
            )
          : undefined;

      if (parentNode) {
        return getLatexX(
          parentNode,
        );
      }
    }

    return getLatexX(node);
  }

  const nodeCommands: string[] =
    [];

  for (const node of normalNodes) {
    const nodeName =
      getLatexNodeName(
        node.id,
      );

    const label =
      formatLatexNodeLabel(
        node.data.label,
        node.data,
      );

    let nodeStyle =
      showNodeBoxes
        ? "syntax phrase"
        : "syntax phrase plain";

    if (
      node.data.kind === "head"
    ) {
      nodeStyle =
        showNodeBoxes
          ? "syntax head"
          : "syntax head plain";
    } else if (
      node.data.kind === "word" ||
      node.data.kind === "wordInput"
    ) {
      nodeStyle =
        showNodeBoxes
          ? "syntax word"
          : "syntax word plain";
    }

    if (node.data.isLowerCopy) {
      nodeStyle +=
        ", syntax lower copy";
    }

    nodeCommands.push(
      [
        `\\node[${nodeStyle}]`,
        `(${nodeName})`,
        `at (${formatLatexNumber(
          getLatexX(node),
        )},${formatLatexNumber(
          getLatexY(node),
        )})`,
        `{${label}};`,
      ].join(" "),
    );
  }

  const summaryCommands:
    string[] = [];

  for (const node of currentNodes) {
    if (
      node.data.kind !==
      "movementSummary"
    ) {
      continue;
    }

    const nodeName =
      getLatexNodeName(
        node.id,
      );

    const parentEdge =
      getSummaryParentEdge(
        node.id,
      );

    const parentNode =
      parentEdge
        ? nodeById.get(
            parentEdge.source,
          )
        : undefined;

    const escapedWords =
      node.data.label.trim()
        ? escapeLatexText(
            node.data.label.trim(),
          )
        : "\\phantom{x}";

    const triangleHalfWidth =
      Math.max(
        0.65,
        Math.min(
          1.75,
          0.55 +
            Array.from(
              node.data.label,
            ).length *
              0.035,
        ),
      );

    const triangleHeight = 0.72;

    if (parentNode) {
      const parentName =
        getLatexNodeName(
          parentNode.id,
        );

      summaryCommands.push(
        `\\coordinate (${nodeName}apex) at (${parentName}.south);`,
      );
    } else {
      summaryCommands.push(
        `\\coordinate (${nodeName}apex) at (${formatLatexNumber(
          getLatexX(node),
        )},${formatLatexNumber(
          getLatexY(node),
        )});`,
      );
    }

    summaryCommands.push(
      [
        `\\coordinate (${nodeName}left)`,
        `at ($(${nodeName}apex)`,
        `+(-${formatLatexNumber(
          triangleHalfWidth,
        )},-${formatLatexNumber(
          triangleHeight,
        )})$);`,
      ].join(" "),
    );

    summaryCommands.push(
      [
        `\\coordinate (${nodeName}right)`,
        `at ($(${nodeName}apex)`,
        `+(${formatLatexNumber(
          triangleHalfWidth,
        )},-${formatLatexNumber(
          triangleHeight,
        )})$);`,
      ].join(" "),
    );

    summaryCommands.push(
      [
        `\\draw[${
          showNodeBoxes
            ? "summary triangle"
            : "summary triangle plain"
        }]`,
        `(${nodeName}apex)`,
        `-- (${nodeName}left)`,
        `-- (${nodeName}right)`,
        "-- cycle;",
      ].join(" "),
    );

    summaryCommands.push(
      [
        `\\node[${
          showNodeBoxes
            ? "syntax word"
            : "syntax word plain"
        }, anchor=north]`,
        `(${nodeName})`,
        `at ($(${nodeName}apex)`,
        `+(0,-${formatLatexNumber(
          triangleHeight,
        )})$)`,
        `{\\sout{${escapedWords}}};`,
      ].join(" "),
    );
  }

  const structuralEdgeCommands =
    structuralEdges
      .filter(
        (edge) => {
          if (edge.hidden) {
            return false;
          }

          const sourceNode =
            nodeById.get(
              edge.source,
            );

          const targetNode =
            nodeById.get(
              edge.target,
            );

          if (
            !sourceNode ||
            !targetNode
          ) {
            return false;
          }

          if (
            !showHeadWordLines &&
            sourceNode.data.kind ===
              "head" &&
            (
              targetNode.data.kind ===
                "word" ||
              targetNode.data.kind ===
                "wordInput"
            )
          ) {
            return false;
          }

          return (
            sourceNode.data.kind !==
              "movementSummary" &&
            targetNode.data.kind !==
              "movementSummary"
          );
        },
      )
      .map((edge) => {
        const sourceName =
          getLatexNodeName(
            edge.source,
          );

        const targetName =
          getLatexNodeName(
            edge.target,
          );

        return [
          "\\draw[tree edge]",
          `(${sourceName}.south)`,
          "--",
          `(${targetName}.north);`,
        ].join(" ");
      });

  const lowestNormalNodeY =
    Math.min(
      ...positionReferenceNodes.map(
        (node) =>
          getLatexY(node) -
          (
            getNodeHeight(node) *
            coordinateScale
          ) /
            2,
      ),
    );

  /*
   * The movement curve is routed below
   * every node and every condensed-copy
   * triangle.
   */
  const movementRouteY =
    lowestNormalNodeY - 2.4;

  const movementEdgeCommands =
    showMovementArrows
      ? movementEdges.map((edge) => {
      const sourceName =
        getLatexNodeName(
          edge.source,
        );

      const targetName =
        getLatexNodeName(
          edge.target,
        );

      const sourceX =
        getExportXByNodeId(
          edge.source,
        );

      const targetX =
        getExportXByNodeId(
          edge.target,
        );

      return [
        "\\draw[movement edge]",
        `(${sourceName}.south)`,
        ".. controls",
        `(${formatLatexNumber(
          sourceX,
        )},${formatLatexNumber(
          movementRouteY,
        )})`,
        "and",
        `(${formatLatexNumber(
          targetX,
        )},${formatLatexNumber(
          movementRouteY,
        )})`,
        "..",
        `(${targetName}.south);`,
      ].join(" ");
    })
      : [];

  return [
    "\\documentclass[tikz,border=8pt]{standalone}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[normalem]{ulem}",
    "\\usepackage{amssymb}",
    "\\usepackage{xcolor}",
    "\\usetikzlibrary{arrows.meta,backgrounds,calc}",
    "",
    "\\definecolor{xbarblue}{HTML}{4D7FC4}",
    "\\definecolor{xbarpurple}{HTML}{7A55B6}",
    "\\definecolor{xbaryellow}{HTML}{B18A22}",
    "\\definecolor{xbarmovement}{HTML}{9B2F43}",
    "",
    "\\tikzset{",
    "  syntax phrase/.style={",
    "    draw=xbarblue,",
    "    fill=xbarblue!7,",
    "    rounded corners=2pt,",
    "    line width=0.8pt,",
    "    inner xsep=5pt,",
    "    inner ysep=3pt,",
    "  },",
    "  syntax head/.style={",
    "    draw=xbarpurple,",
    "    fill=xbarpurple!7,",
    "    rounded corners=2pt,",
    "    line width=0.8pt,",
    "    inner xsep=5pt,",
    "    inner ysep=3pt,",
    "  },",
    "  syntax word/.style={",
    "    draw=xbaryellow,",
    "    fill=xbaryellow!7,",
    "    rounded corners=2pt,",
    "    line width=0.8pt,",
    "    inner xsep=5pt,",
    "    inner ysep=3pt,",
    "  },",
    "  syntax phrase plain/.style={",
    "    draw=none,",
    "    fill=none,",
    "    inner xsep=5pt,",
    "    inner ysep=3pt,",
    "  },",
    "  syntax head plain/.style={",
    "    draw=none,",
    "    fill=none,",
    "    inner xsep=5pt,",
    "    inner ysep=3pt,",
    "  },",
    "  syntax word plain/.style={",
    "    draw=none,",
    "    fill=none,",
    "    inner xsep=5pt,",
    "    inner ysep=3pt,",
    "  },",
    "  syntax lower copy/.style={",
    "    dashed,",
    "    opacity=0.82",
    "  },",
    "  tree edge/.style={",
    "    draw=black!75,",
    "    line width=0.8pt",
    "  },",
    "  summary triangle/.style={",
    "    draw=black!85,",
    "    fill=white,",
    "    line width=0.9pt",
    "  },",
    "  summary triangle plain/.style={",
    "    draw=black!85,",
    "    fill=none,",
    "    line width=0.9pt",
    "  },",
    "  movement edge/.style={",
    "    draw=xbarmovement,",
    "    dashed,",
    "    line width=1pt,",
    "    -{Latex[length=2.3mm,width=1.8mm]}",
    "  }",
    "}",
    "",
    "\\pagestyle{empty}",
    "",
    "\\begin{document}",
    "\\begin{tikzpicture}[x=1cm,y=1cm]",
    "",
    ...nodeCommands,
    ...summaryCommands,
    "",
    "\\begin{scope}[on background layer]",
    ...structuralEdgeCommands,
    ...movementEdgeCommands,
    "\\end{scope}",
    "",
    "\\end{tikzpicture}",
    "\\end{document}",
    "",
  ].join("\n");
}

function waitForTreePaint():
  Promise<void> {
  return new Promise(
    (resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(
          () => resolve(),
        );
      });
    },
  );
}

function getNodeAtFlowPosition(
  position: {
    x: number;
    y: number;
  },
  currentNodes: readonly SyntaxNode[],
): SyntaxNode | null {
  const matchingNodes =
    currentNodes.filter((node) => {
      if (
        node.data.kind === "word" ||
        node.data.kind === "wordInput"
      ) {
        return false;
      }

      const width =
        node.measured?.width ??
        getSyntaxNodeWidth(node);

      const height =
        node.measured?.height ?? 40;

      return (
        position.x >= node.position.x &&
        position.x <=
          node.position.x + width &&
        position.y >= node.position.y &&
        position.y <=
          node.position.y + height
      );
    });

  /*
   * In the unlikely case that nodes overlap,
   * use the smallest matching node.
   */
  matchingNodes.sort(
    (firstNode, secondNode) => {
      const firstArea =
        (
          firstNode.measured?.width ??
          getSyntaxNodeWidth(firstNode)
        ) *
        (
          firstNode.measured?.height ??
          40
        );

      const secondArea =
        (
          secondNode.measured?.width ??
          getSyntaxNodeWidth(secondNode)
        ) *
        (
          secondNode.measured?.height ??
          40
        );

      return firstArea - secondArea;
    },
  );

  return matchingNodes[0] ?? null;
}

const TREE_SESSION_STORAGE_KEY =
  "xbar-tree-builder-session-v1";

const SHOW_NODE_BOXES_STORAGE_KEY =
  "xbar-tree-builder-show-node-boxes-v1";

const SHOW_MOVEMENT_ARROWS_STORAGE_KEY =
  "xbar-tree-builder-show-movement-arrows-v1";

const SHOW_HEAD_WORD_LINES_STORAGE_KEY =
  "xbar-tree-builder-show-head-word-lines-v1";

const TREE_LAYOUT_MODE_STORAGE_KEY =
  "xbar-tree-builder-layout-mode-v1";

const COLLAPSE_UNUSED_BAR_LEVELS_STORAGE_KEY =
  "xbar-tree-builder-collapse-unused-bars-v1";

function loadShowNodeBoxes(): boolean {
  if (
    typeof window === "undefined"
  ) {
    return true;
  }

  try {
    const savedValue =
      window.localStorage.getItem(
        SHOW_NODE_BOXES_STORAGE_KEY,
      );

    if (savedValue === null) {
      const hasSavedTree =
        window.localStorage.getItem(
          TREE_SESSION_STORAGE_KEY,
        ) !== null;

      return hasSavedTree;
    }

    return savedValue === "true";
  } catch {
    return true;
  }
}


function loadShowMovementArrows(): boolean {
  if (
    typeof window === "undefined"
  ) {
    return true;
  }

  try {
    const savedValue =
      window.localStorage.getItem(
        SHOW_MOVEMENT_ARROWS_STORAGE_KEY,
      );

    if (savedValue === null) {
      return true;
    }

    return savedValue === "true";
  } catch {
    return true;
  }
}

function loadShowHeadWordLines(): boolean {
  if (
    typeof window === "undefined"
  ) {
    return true;
  }

  try {
    const savedValue =
      window.localStorage.getItem(
        SHOW_HEAD_WORD_LINES_STORAGE_KEY,
      );

    if (savedValue === null) {
      return true;
    }

    return savedValue === "true";
  } catch {
    return true;
  }
}

function loadTreeLayoutMode():
  TreeLayoutMode {
  if (
    typeof window === "undefined"
  ) {
    return "topDown";
  }

  try {
    const savedValue =
      window.localStorage.getItem(
        TREE_LAYOUT_MODE_STORAGE_KEY,
      );

    return savedValue === "bottomUp"
      ? "bottomUp"
      : "topDown";
  } catch {
    return "topDown";
  }
}

function loadCollapseUnusedBarLevels():
  boolean {
  if (
    typeof window === "undefined"
  ) {
    return false;
  }

  try {
    return (
      window.localStorage.getItem(
        COLLAPSE_UNUSED_BAR_LEVELS_STORAGE_KEY,
      ) === "true"
    );
  } catch {
    return false;
  }
}

interface SavedTreeSession {
  nodes: SyntaxNode[];
  edges: Edge[];
  nextNodeNumber: number;
}

function createDemoTreeSession():
  SavedTreeSession {
  function createDemoNode(
    nodeNumber: number,
    label: string,
    kind: NodeKind,
    x: number,
    y: number,
    options?: {
      isLowerCopy?: boolean;
      draggable?: boolean;
      textStrikethrough?: boolean;
    },
  ): SyntaxNode {
    return {
      id:
        `syntax-node-${nodeNumber}`,
      type: "syntaxNode",
      position: {
        x,
        y,
      },
      data: {
        label,
        kind,
        isLowerCopy:
          options?.isLowerCopy,
        textStrikethrough:
          options?.textStrikethrough,
      },
      draggable:
        options?.draggable,
      selected: false,
      dragging: false,
    };
  }

  function createDemoEdge(
    sourceNumber: number,
    targetNumber: number,
    siblingOrder = 0,
    hidden = false,
  ): Edge {
    return {
      id:
        `edge-syntax-node-${sourceNumber}-syntax-node-${targetNumber}`,
      source:
        `syntax-node-${sourceNumber}`,
      target:
        `syntax-node-${targetNumber}`,
      type: "tree",
      hidden,
      data: {
        edgeKind: "tree",
        siblingOrder,
      },
    };
  }

  function createDemoMovementEdge(
    sourceNumber: number,
    targetNumber: number,
  ): Edge {
    return {
      id:
        `movement-syntax-node-${sourceNumber}-syntax-node-${targetNumber}`,
      source:
        `syntax-node-${sourceNumber}`,
      target:
        `syntax-node-${targetNumber}`,
      sourceHandle:
        "movement-source",
      targetHandle:
        "movement-target",
      type: "movement",
      data: {
        edgeKind: "movement",
      },
      markerEnd: {
        type:
          MarkerType.ArrowClosed,
        color: "#8b2f3f",
        width: 18,
        height: 18,
      },
      style: {
        stroke: "#8b2f3f",
        strokeWidth: 2.25,
        strokeDasharray: "7 4",
      },
      zIndex: 0,
      selectable: false,
    };
  }

  /*
   * Demonstration tree:
   *
   * CP
   *  └─ C′
   *     ├─ C → -Q
   *     └─ TP
   *        ├─ NP → N′ → N → Trevor
   *        └─ T′
   *           ├─ T → +Past
   *           └─ ProgP
   *              └─ Prog′
   *                 ├─ Prog → is
   *                 └─ VoiceP
   *                    ├─ NP → △ Trevor
   *                    └─ Voice′
   *                       ├─ Voice
   *                       │  ├─ Voice → +Active
   *                       │  └─ V → eating
   *                       └─ VP
   *                          ├─ NP → △ Trevor
   *                          └─ V′
   *                             ├─ V → △ eating
   *                             └─ NP → N′ → N → pancakes
   */
  const demoNodes:
    SyntaxNode[] = [
    createDemoNode(
      1,
      "CP",
      "phrase",
      460,
      30,
    ),
    createDemoNode(
      2,
      "C′",
      "phrase",
      460,
      85,
    ),
    createDemoNode(
      3,
      "C",
      "head",
      80,
      140,
    ),
    createDemoNode(
      4,
      "-Q",
      "wordInput",
      80,
      195,
    ),
    createDemoNode(
      5,
      "TP",
      "phrase",
      520,
      140,
    ),
    createDemoNode(
      6,
      "NP",
      "phrase",
      160,
      195,
    ),
    createDemoNode(
      7,
      "N′",
      "phrase",
      160,
      250,
    ),
    createDemoNode(
      8,
      "N",
      "head",
      160,
      305,
    ),
    createDemoNode(
      9,
      "Trevor",
      "wordInput",
      160,
      360,
    ),
    createDemoNode(
      10,
      "T′",
      "phrase",
      560,
      195,
    ),
    createDemoNode(
      11,
      "T",
      "head",
      260,
      250,
    ),
    createDemoNode(
      12,
      "-Past",
      "wordInput",
      260,
      305,
    ),
    createDemoNode(
      13,
      "ProgP",
      "phrase",
      610,
      250,
    ),
    createDemoNode(
      14,
      "Prog′",
      "phrase",
      610,
      305,
    ),
    createDemoNode(
      15,
      "Prog",
      "head",
      360,
      360,
    ),
    createDemoNode(
      16,
      "is",
      "wordInput",
      360,
      415,
    ),
    createDemoNode(
      17,
      "VoiceP",
      "phrase",
      650,
      360,
    ),
    createDemoNode(
      18,
      "NP",
      "phrase",
      490,
      415,
      {
        isLowerCopy: true,
        draggable: false,
      },
    ),
    createDemoNode(
      19,
      "Trevor",
      "movementSummary",
      490,
      470,
      {
        isLowerCopy: true,
        draggable: false,
        textStrikethrough: true,
      },
    ),
    createDemoNode(
      20,
      "Voice′",
      "phrase",
      720,
      415,
    ),
    createDemoNode(
      21,
      "Voice",
      "head",
      570,
      470,
    ),
    createDemoNode(
      22,
      "Voice",
      "head",
      520,
      525,
    ),
    createDemoNode(
      23,
      "+Active",
      "wordInput",
      520,
      580,
    ),
    createDemoNode(
      24,
      "V",
      "head",
      620,
      525,
    ),
    createDemoNode(
      25,
      "eating",
      "wordInput",
      620,
      580,
    ),
    createDemoNode(
      26,
      "VP",
      "phrase",
      790,
      470,
    ),
    createDemoNode(
      27,
      "NP",
      "phrase",
      690,
      525,
      {
        isLowerCopy: true,
        draggable: false,
      },
    ),
    createDemoNode(
      28,
      "Trevor",
      "movementSummary",
      690,
      580,
      {
        isLowerCopy: true,
        draggable: false,
        textStrikethrough: true,
      },
    ),
    createDemoNode(
      29,
      "V′",
      "phrase",
      850,
      525,
    ),
    createDemoNode(
      30,
      "V",
      "head",
      790,
      580,
      {
        isLowerCopy: true,
        draggable: false,
      },
    ),
    createDemoNode(
      31,
      "eating",
      "movementSummary",
      790,
      635,
      {
        isLowerCopy: true,
        draggable: false,
        textStrikethrough: true,
      },
    ),
    createDemoNode(
      32,
      "NP",
      "phrase",
      930,
      580,
    ),
    createDemoNode(
      33,
      "N′",
      "phrase",
      930,
      635,
    ),
    createDemoNode(
      34,
      "N",
      "head",
      930,
      690,
    ),
    createDemoNode(
      35,
      "pancakes",
      "wordInput",
      930,
      745,
    ),
  ];

  const demoEdges: Edge[] = [
    createDemoEdge(1, 2),

    createDemoEdge(2, 3, 0),
    createDemoEdge(3, 4),
    createDemoEdge(2, 5, 1),

    createDemoEdge(5, 6, 0),
    createDemoEdge(6, 7),
    createDemoEdge(7, 8),
    createDemoEdge(8, 9),

    createDemoEdge(5, 10, 1),
    createDemoEdge(10, 11, 0),
    createDemoEdge(11, 12),
    createDemoEdge(10, 13, 1),

    createDemoEdge(13, 14),
    createDemoEdge(14, 15, 0),
    createDemoEdge(15, 16),
    createDemoEdge(14, 17, 1),

    createDemoEdge(17, 18, 0),
    createDemoEdge(
      18,
      19,
      0,
      true,
    ),

    createDemoEdge(17, 20, 1),
    createDemoEdge(20, 21, 0),

    createDemoEdge(21, 22, 0),
    createDemoEdge(22, 23),
    createDemoEdge(21, 24, 1),
    createDemoEdge(24, 25),

    createDemoEdge(20, 26, 1),
    createDemoEdge(26, 27, 0),
    createDemoEdge(
      27,
      28,
      0,
      true,
    ),

    createDemoEdge(26, 29, 1),
    createDemoEdge(29, 30, 0),
    createDemoEdge(
      30,
      31,
      0,
      true,
    ),

    createDemoEdge(29, 32, 1),
    createDemoEdge(32, 33),
    createDemoEdge(33, 34),
    createDemoEdge(34, 35),

    /*
     * Successive-cyclic subject movement:
     *
     * VP subject trace
     *   → VoiceP subject trace
     *   → pronounced TP subject
     */
    createDemoMovementEdge(
      28,
      19,
    ),
    createDemoMovementEdge(
      19,
      9,
    ),
  ];

  const balancedDemoNodes =
    layoutAllTreeComponents(
      demoNodes,
      demoEdges,
      false,
      true,
      "topDown",
      false,
    );

  return {
    nodes: balancedDemoNodes,
    edges: demoEdges,
    nextNodeNumber: 36,
  };
}

function calculateNextNodeNumber(
  currentNodes: readonly SyntaxNode[],
): number {
  let highestNodeNumber = 0;

  for (const node of currentNodes) {
    const match = node.id.match(
      /^syntax-node-(\d+)$/,
    );

    if (!match) {
      continue;
    }

    const nodeNumber = Number(match[1]);

    if (
      Number.isFinite(nodeNumber)
    ) {
      highestNodeNumber = Math.max(
        highestNodeNumber,
        nodeNumber,
      );
    }
  }

  return highestNodeNumber + 1;
}

function createSavedTreeSession(
  currentNodes: readonly SyntaxNode[],
  currentEdges: readonly Edge[],
  nextNodeNumber: number,
): SavedTreeSession {
  return {
    nodes: currentNodes.map(
      (node): SyntaxNode => ({
        ...node,
        position: {
          ...node.position,
        },
        data: {
          ...node.data,
        },
        selected: false,
        dragging: false,
      }),
    ),

    edges: currentEdges.map(
      (edge): Edge => ({
        ...edge,
        data: edge.data
          ? {
              ...edge.data,
            }
          : undefined,
        selected: false,
      }),
    ),

    nextNodeNumber,
  };
}

function loadSavedTreeSession():
  SavedTreeSession {
  const emptySession: SavedTreeSession = {
    nodes: [],
    edges: [],
    nextNodeNumber: 1,
  };

  if (
    typeof window === "undefined"
  ) {
    return emptySession;
  }

  try {
    const savedValue =
      window.localStorage.getItem(
        TREE_SESSION_STORAGE_KEY,
      );

    if (!savedValue) {
      return createDemoTreeSession();
    }

    const parsedValue =
      JSON.parse(
        savedValue,
      ) as Partial<SavedTreeSession>;

    if (
      !Array.isArray(
        parsedValue.nodes,
      ) ||
      !Array.isArray(
        parsedValue.edges,
      )
    ) {
      return emptySession;
    }

    const restoredNodes =
      parsedValue.nodes.map(
        (node): SyntaxNode => ({
          ...node,
          position: {
            ...node.position,
          },
          data: {
            ...node.data,
          },
          selected: false,
          dragging: false,
        }),
      );

    const restoredEdges =
      parsedValue.edges.map(
        (edge): Edge => ({
          ...edge,
          data: edge.data
            ? {
                ...edge.data,
              }
            : undefined,
          selected: false,
        }),
      );

    const calculatedNextNumber =
      calculateNextNodeNumber(
        restoredNodes,
      );

    const savedNextNumber =
      typeof parsedValue
        .nextNodeNumber ===
        "number" &&
      Number.isFinite(
        parsedValue.nextNodeNumber,
      )
        ? parsedValue.nextNodeNumber
        : 1;

    return {
      nodes: restoredNodes,
      edges: restoredEdges,
      nextNodeNumber: Math.max(
        1,
        savedNextNumber,
        calculatedNextNumber,
      ),
    };
  } catch (error) {
    console.error(
      "The saved tree could not be loaded.",
      error,
    );

    return emptySession;
  }
}

function saveTreeSession(
  session: SavedTreeSession,
) {
  try {
    window.localStorage.setItem(
      TREE_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    );
  } catch (error) {
    console.error(
      "The tree could not be saved.",
      error,
    );
  }
}

function TreeBuilder() {
  const [initialSession] =
    useState<SavedTreeSession>(
      loadSavedTreeSession,
    );

  const [
    nodes,
    setNodes,
    onNodesChange,
  ] = useNodesState<SyntaxNode>(
    initialSession.nodes,
  );

  const [
    edges,
    setEdges,
    onEdgesChange,
  ] = useEdgesState<Edge>(
    initialSession.edges,
  );

  const [
    reactFlowInstance,
    setReactFlowInstance,
  ] = useState<
    ReactFlowInstance<
      SyntaxNode,
      Edge
    > | null
  >(null);

  const [
  pendingBarAttachment,
  setPendingBarAttachment,
] = useState<
  PendingBarAttachment | null
>(null);

  const nextNodeNumber = useRef(
  initialSession.nextNodeNumber,
);

  const flowCanvasRef =
  useRef<HTMLDivElement>(null);

  const latestSessionRef =
  useRef<SavedTreeSession>(
    initialSession,
  );

  const undoStackRef =
  useRef<TreeSnapshot[]>([]);

const dragStartSnapshotRef =
  useRef<TreeSnapshot | null>(null);

const [undoCount, setUndoCount] =
  useState(0);

const [
  showNodeBoxes,
  setShowNodeBoxes,
] = useState<boolean>(
  loadShowNodeBoxes,
);

const [
  showMovementArrows,
  setShowMovementArrows,
] = useState<boolean>(
  loadShowMovementArrows,
);

const [
  showHeadWordLines,
  setShowHeadWordLines,
] = useState<boolean>(
  loadShowHeadWordLines,
);

const [
  treeLayoutMode,
  setTreeLayoutMode,
] = useState<TreeLayoutMode>(
  loadTreeLayoutMode,
);

const [
  collapseUnusedBarLevels,
  setCollapseUnusedBarLevels,
] = useState<boolean>(
  loadCollapseUnusedBarLevels,
);

const [
  selectionBoxActive,
  setSelectionBoxActive,
] = useState(false);

useEffect(() => {
  try {
    window.localStorage.setItem(
      SHOW_NODE_BOXES_STORAGE_KEY,
      String(showNodeBoxes),
    );
  } catch (error) {
    console.error(
      "The box display setting could not be saved.",
      error,
    );
  }
}, [showNodeBoxes]);

useEffect(() => {
  try {
    window.localStorage.setItem(
      SHOW_MOVEMENT_ARROWS_STORAGE_KEY,
      String(showMovementArrows),
    );
  } catch (error) {
    console.error(
      "The movement-arrow setting could not be saved.",
      error,
    );
  }
}, [showMovementArrows]);

useEffect(() => {
  try {
    window.localStorage.setItem(
      SHOW_HEAD_WORD_LINES_STORAGE_KEY,
      String(showHeadWordLines),
    );
  } catch (error) {
    console.error(
      "The head-to-word line setting could not be saved.",
      error,
    );
  }
}, [showHeadWordLines]);

useEffect(() => {
  try {
    window.localStorage.setItem(
      TREE_LAYOUT_MODE_STORAGE_KEY,
      treeLayoutMode,
    );
  } catch (error) {
    console.error(
      "The tree layout mode could not be saved.",
      error,
    );
  }
}, [treeLayoutMode]);

useEffect(() => {
  try {
    window.localStorage.setItem(
      COLLAPSE_UNUSED_BAR_LEVELS_STORAGE_KEY,
      String(
        collapseUnusedBarLevels,
      ),
    );
  } catch (error) {
    console.error(
      "The unused-bar setting could not be saved.",
      error,
    );
  }
}, [collapseUnusedBarLevels]);

const autoBalanceFrameRef =
  useRef<number | null>(null);

const isNodeDragActiveRef =
  useRef(false);

const latestLayoutNodesRef =
  useRef<readonly SyntaxNode[]>(
    nodes,
  );

const latestLayoutEdgesRef =
  useRef<readonly Edge[]>(
    edges,
  );

/*
 * These assignments intentionally happen
 * during render. They keep the refs current
 * without making scheduleAutoBalance depend
 * on every drag-position update.
 */
latestLayoutNodesRef.current =
  nodes;

latestLayoutEdgesRef.current =
  edges;

const cancelScheduledAutoBalance =
  useCallback(() => {
    if (
      autoBalanceFrameRef.current ===
      null
    ) {
      return;
    }

    cancelAnimationFrame(
      autoBalanceFrameRef.current,
    );

    autoBalanceFrameRef.current =
      null;
  }, []);

const scheduleAutoBalance =
  useCallback(() => {
    if (
      !reactFlowInstance ||
      isNodeDragActiveRef.current
    ) {
      return;
    }

    cancelScheduledAutoBalance();

    /*
     * Two animation frames allow React Flow
     * to finish measuring newly created,
     * edited, moved, or boxless nodes first.
     */
    autoBalanceFrameRef.current =
      requestAnimationFrame(() => {
        if (
          isNodeDragActiveRef.current
        ) {
          autoBalanceFrameRef.current =
            null;

          return;
        }

        autoBalanceFrameRef.current =
          requestAnimationFrame(() => {
            if (
              isNodeDragActiveRef.current
            ) {
              autoBalanceFrameRef.current =
                null;

              return;
            }

            const storedNodes =
              latestLayoutNodesRef.current;

            const storedEdges =
              latestLayoutEdgesRef.current;

            const renderedNodes =
              reactFlowInstance
                .getNodes();

            const renderedNodeById =
              new Map(
                renderedNodes.map(
                  (node) => [
                    node.id,
                    node,
                  ],
                ),
              );

            /*
             * React Flow contains only visible
             * nodes while unary bar levels are
             * collapsed. Merge current visible
             * measurements into the complete
             * stored graph before balancing.
             */
            const currentNodes =
              storedNodes.map((node) => {
                const renderedNode =
                  renderedNodeById.get(
                    node.id,
                  );

                if (!renderedNode) {
                  return node;
                }

                return {
                  ...node,
                  position: {
                    ...renderedNode.position,
                  },
                  measured:
                    renderedNode.measured
                      ? {
                          ...renderedNode
                            .measured,
                        }
                      : node.measured,
                };
              });

            const balancedNodes =
              layoutAllTreeComponents(
                currentNodes,
                storedEdges,
                showNodeBoxes,
                showHeadWordLines,
                treeLayoutMode,
                collapseUnusedBarLevels,
              );

            if (
              nodePositionsChanged(
                storedNodes,
                balancedNodes,
              )
            ) {
              setNodes(
                balancedNodes,
              );
            }

            autoBalanceFrameRef.current =
              null;
          });
      });
  }, [
    cancelScheduledAutoBalance,
    collapseUnusedBarLevels,
    reactFlowInstance,
    setNodes,
    showHeadWordLines,
    showNodeBoxes,
    treeLayoutMode,
  ]);

useEffect(() => {
  return () => {
    cancelScheduledAutoBalance();
  };
}, [
  cancelScheduledAutoBalance,
]);

/*
 * Rebalance after structural changes,
 * node creation/deletion, restored sessions,
 * and display-setting changes. Position-only
 * updates during a pointer drag do not trigger
 * this effect.
 */
const layoutStructureSignature = [
  nodes
    .map(
      (node) =>
        `${node.id}:${node.data.kind}:${Boolean(
          node.data.isLowerCopy,
        )}`,
    )
    .join("|"),

  edges
    .filter(
      (edge) =>
        !isMovementEdge(edge),
    )
    .map(
      (edge) =>
        [
          edge.id,
          edge.source,
          edge.target,
          getSiblingOrder(edge),
          Boolean(edge.hidden),
        ].join(":"),
    )
    .join("|"),
].join("||");

useEffect(() => {
  scheduleAutoBalance();
}, [
  layoutStructureSignature,
  scheduleAutoBalance,
  collapseUnusedBarLevels,
  showNodeBoxes,
  treeLayoutMode,
]);

/*
 * Save shortly after any node or edge change.
 */
useEffect(() => {
  const session =
    createSavedTreeSession(
      nodes,
      edges,
      nextNodeNumber.current,
    );

  latestSessionRef.current =
    session;

  const saveTimer =
    window.setTimeout(() => {
      saveTreeSession(session);
    }, 250);

  return () => {
    window.clearTimeout(saveTimer);
  };
}, [nodes, edges]);

/*
 * Save immediately when the page is closed,
 * refreshed, or navigated away from.
 */
useEffect(() => {
  function saveBeforeLeaving() {
    saveTreeSession(
      latestSessionRef.current,
    );
  }

  window.addEventListener(
    "pagehide",
    saveBeforeLeaving,
  );

  return () => {
    window.removeEventListener(
      "pagehide",
      saveBeforeLeaving,
    );
  };
}, []);

const pushUndoSnapshot =
  useCallback(
    (snapshot: TreeSnapshot) => {
      undoStackRef.current = [
        ...undoStackRef.current,
        snapshot,
      ].slice(-50);

      setUndoCount(
        undoStackRef.current.length,
      );
    },
    [],
  );

const saveUndoSnapshot =
  useCallback(() => {
    pushUndoSnapshot(
      createTreeSnapshot(
        nodes,
        edges,
      ),
    );
  }, [
    edges,
    nodes,
    pushUndoSnapshot,
  ]);

const undoLastAction =
  useCallback(() => {
    const previousSnapshot =
      undoStackRef.current.pop();

    if (!previousSnapshot) {
      return;
    }

    isNodeDragActiveRef.current =
      false;

    cancelScheduledAutoBalance();

    setPendingBarAttachment(null);

    setNodes(
      previousSnapshot.nodes,
    );

    setEdges(
      previousSnapshot.edges,
    );

    setUndoCount(
      undoStackRef.current.length,
    );
  }, [
    cancelScheduledAutoBalance,
    setEdges,
    setNodes,
  ]);

useEffect(() => {
  function handleUndoShortcut(
    event: KeyboardEvent,
  ) {
    const target = event.target;

    const isEditingText =
      target instanceof
        HTMLInputElement ||
      target instanceof
        HTMLTextAreaElement ||
      (
        target instanceof HTMLElement &&
        target.isContentEditable
      );

    if (isEditingText) {
      return;
    }

    const isUndoShortcut =
      (
        event.ctrlKey ||
        event.metaKey
      ) &&
      !event.shiftKey &&
      event.key.toLowerCase() ===
        "z";

    if (!isUndoShortcut) {
      return;
    }

    event.preventDefault();
    undoLastAction();
  }

  window.addEventListener(
    "keydown",
    handleUndoShortcut,
  );

  return () => {
    window.removeEventListener(
      "keydown",
      handleUndoShortcut,
    );
  };
}, [undoLastAction]);

const handleNodeDragStart:
  OnNodeDrag<SyntaxNode> =
  useCallback(() => {
    /*
     * A pending automatic layout must not
     * write an older balanced position while
     * the pointer is actively moving a node.
     */
    isNodeDragActiveRef.current =
      true;

    cancelScheduledAutoBalance();

    dragStartSnapshotRef.current =
      createTreeSnapshot(
        nodes,
        edges,
      );
  }, [
    cancelScheduledAutoBalance,
    edges,
    nodes,
  ]);

const onConnect =
  useCallback(
    (connection: Connection) => {
      saveUndoSnapshot();

      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            type: "tree",
            data: {
              edgeKind: "tree",
              siblingOrder: 0,
            },
          },
          currentEdges,
        ),
      );
    },
    [
      saveUndoSnapshot,
      setEdges,
    ],
  );

function attachDirectly(
  attachment: PendingBarAttachment,
) {
  const parentNode = nodes.find(
    (node) =>
      node.id === attachment.parentId,
  );

  const draggedNode = nodes.find(
    (node) =>
      node.id === attachment.draggedId,
  );

  if (!parentNode || !draggedNode) {
    setPendingBarAttachment(null);
    return;
  }

  if (
    wouldCreateCycle(
      parentNode.id,
      draggedNode.id,
      edges,
    )
  ) {
    setPendingBarAttachment(null);
    return;
  }

  const previousParentEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target === draggedNode.id,
    );

  const edgesWithoutOldParent =
    edges.filter(
      (edge) =>
        isMovementEdge(edge) ||
        edge.target !== draggedNode.id,
    );

  const existingSisterEdges =
    edgesWithoutOldParent.filter(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.source === parentNode.id,
    );

  const existingOrders =
    existingSisterEdges.map(
      getSiblingOrder,
    );

  let newSiblingOrder = 0;

  if (existingOrders.length > 0) {
    newSiblingOrder =
      attachment.placeOnLeft
        ? Math.min(...existingOrders) - 1
        : Math.max(...existingOrders) + 1;
  }

  const updatedEdges = addEdge(
    {
      id:
        `edge-${parentNode.id}-${draggedNode.id}`,
      source: parentNode.id,
      target: draggedNode.id,
      type: "straight",
      data: {
        siblingOrder:
          newSiblingOrder,
      },
    },
    edgesWithoutOldParent,
  );

  const nodeSnapshot =
    nodes.map((node) => {
      if (
        node.id !== draggedNode.id
      ) {
        return node;
      }

      return {
        ...node,
        position:
          attachment.draggedPosition,
      };
    });

  let balancedNodes =
    layoutTreeComponent(
      nodeSnapshot,
      updatedEdges,
      parentNode.id,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  if (
    previousParentEdge &&
    previousParentEdge.source !==
      parentNode.id
  ) {
    balancedNodes =
      layoutTreeComponent(
        balancedNodes,
        updatedEdges,
        previousParentEdge.source,
        showNodeBoxes,
        showHeadWordLines,
        treeLayoutMode,
        collapseUnusedBarLevels,
      );
  }

  setEdges(updatedEdges);
  setNodes(balancedNodes);
  setPendingBarAttachment(null);
}

function attachAsAdjunct(
  attachment: PendingBarAttachment,
) {
  const lowerBarNode = nodes.find(
    (node) =>
      node.id === attachment.parentId,
  );

  const adjunctNode = nodes.find(
    (node) =>
      node.id === attachment.draggedId,
  );

  if (!lowerBarNode || !adjunctNode) {
    setPendingBarAttachment(null);
    return;
  }

  if (
    wouldCreateCycle(
      lowerBarNode.id,
      adjunctNode.id,
      edges,
    )
  ) {
    setPendingBarAttachment(null);
    return;
  }

  const incomingBarEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target === lowerBarNode.id,
    );

  const previousAdjunctParentEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target === adjunctNode.id,
    );

  const newBarId =
    `syntax-node-${nextNodeNumber.current}`;

  nextNodeNumber.current += 1;

  const newUpperBarNode:
    SyntaxNode = {
    id: newBarId,
    type: "syntaxNode",
    position: {
      x: lowerBarNode.position.x,
      y: lowerBarNode.position.y,
    },
    data: {
      label:
        lowerBarNode.data.label,
      kind: "phrase",
    },
  };

  let updatedEdges =
    edges.filter((edge) => {
      if (
        !isMovementEdge(edge) &&
        edge.target === adjunctNode.id
      ) {
        return false;
      }

      if (
        incomingBarEdge &&
        edge.id === incomingBarEdge.id
      ) {
        return false;
      }

      return true;
    });

  if (incomingBarEdge) {
    updatedEdges = addEdge(
      {
        id:
          `edge-${incomingBarEdge.source}-${newBarId}`,
        source:
          incomingBarEdge.source,
        target: newBarId,
        type: "straight",
        data: {
          siblingOrder:
            getSiblingOrder(
              incomingBarEdge,
            ),
        },
      },
      updatedEdges,
    );
  }

  const leftDaughterId =
    attachment.placeOnLeft
      ? adjunctNode.id
      : lowerBarNode.id;

  const rightDaughterId =
    attachment.placeOnLeft
      ? lowerBarNode.id
      : adjunctNode.id;

  updatedEdges = addEdge(
    {
      id:
        `edge-${newBarId}-${leftDaughterId}`,
      source: newBarId,
      target: leftDaughterId,
      type: "straight",
      data: {
        siblingOrder: 0,
      },
    },
    updatedEdges,
  );

  updatedEdges = addEdge(
    {
      id:
        `edge-${newBarId}-${rightDaughterId}`,
      source: newBarId,
      target: rightDaughterId,
      type: "straight",
      data: {
        siblingOrder: 1,
      },
    },
    updatedEdges,
  );

  const nodeSnapshot:
    SyntaxNode[] = [
    ...nodes.map((node) => {
      if (
        node.id !== adjunctNode.id
      ) {
        return node;
      }

      return {
        ...node,
        position:
          attachment.draggedPosition,
      };
    }),
    newUpperBarNode,
  ];

  let balancedNodes =
    layoutTreeComponent(
      nodeSnapshot,
      updatedEdges,
      newBarId,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  if (
    previousAdjunctParentEdge &&
    previousAdjunctParentEdge.source !==
      lowerBarNode.id
  ) {
    balancedNodes =
      layoutTreeComponent(
        balancedNodes,
        updatedEdges,
        previousAdjunctParentEdge.source,
        showNodeBoxes,
        showHeadWordLines,
        treeLayoutMode,
        collapseUnusedBarLevels,
      );
  }

  setEdges(updatedEdges);
  setNodes(balancedNodes);
  setPendingBarAttachment(null);
}


function attachHeadAsAdjunct(
  attachment: PendingBarAttachment,
) {
  const lowerHeadNode =
    nodes.find(
      (node) =>
        node.id ===
        attachment.parentId,
    );

  const adjunctHeadNode =
    nodes.find(
      (node) =>
        node.id ===
        attachment.draggedId,
    );

  if (
    !lowerHeadNode ||
    !adjunctHeadNode ||
    lowerHeadNode.data.kind !==
      "head" ||
    adjunctHeadNode.data.kind !==
      "head"
  ) {
    setPendingBarAttachment(null);
    return;
  }

  if (
    wouldCreateCycle(
      lowerHeadNode.id,
      adjunctHeadNode.id,
      edges,
    )
  ) {
    setPendingBarAttachment(null);
    return;
  }

  /*
   * Head adjunction creates a new upper
   * copy of the target head:
   *
   *       C
   *      / \
   *     T   C
   *
   * The original C and all of its lexical
   * material remain intact underneath.
   */
  const incomingHeadEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target ===
          lowerHeadNode.id,
    );

  const previousAdjunctParentEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target ===
          adjunctHeadNode.id,
    );

  const newUpperHeadId =
    `syntax-node-${nextNodeNumber.current}`;

  nextNodeNumber.current += 1;

  const newUpperHeadNode:
    SyntaxNode = {
    id: newUpperHeadId,
    type: "syntaxNode",
    position: {
      ...lowerHeadNode.position,
    },
    data: {
      ...lowerHeadNode.data,
      kind: "head",
      isLowerCopy: false,
    },
  };

  let updatedEdges =
    edges.filter((edge) => {
      if (
        !isMovementEdge(edge) &&
        edge.target ===
          adjunctHeadNode.id
      ) {
        return false;
      }

      if (
        incomingHeadEdge &&
        edge.id ===
          incomingHeadEdge.id
      ) {
        return false;
      }

      return true;
    });

  if (incomingHeadEdge) {
    updatedEdges = addEdge(
      {
        id:
          `edge-${incomingHeadEdge.source}-${newUpperHeadId}`,
        source:
          incomingHeadEdge.source,
        target:
          newUpperHeadId,
        type: "straight",
        data: {
          edgeKind: "tree",
          siblingOrder:
            getSiblingOrder(
              incomingHeadEdge,
            ),
        },
      },
      updatedEdges,
    );
  }

  const leftDaughterId =
    attachment.placeOnLeft
      ? adjunctHeadNode.id
      : lowerHeadNode.id;

  const rightDaughterId =
    attachment.placeOnLeft
      ? lowerHeadNode.id
      : adjunctHeadNode.id;

  updatedEdges = addEdge(
    {
      id:
        `edge-${newUpperHeadId}-${leftDaughterId}`,
      source: newUpperHeadId,
      target: leftDaughterId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder: 0,
      },
    },
    updatedEdges,
  );

  updatedEdges = addEdge(
    {
      id:
        `edge-${newUpperHeadId}-${rightDaughterId}`,
      source: newUpperHeadId,
      target: rightDaughterId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder: 1,
      },
    },
    updatedEdges,
  );

  const nodeSnapshot:
    SyntaxNode[] = [
    ...nodes.map((node) => {
      if (
        node.id !==
        adjunctHeadNode.id
      ) {
        return node;
      }

      return {
        ...node,
        position: {
          ...attachment
            .draggedPosition,
        },
      };
    }),
    newUpperHeadNode,
  ];

  let balancedNodes =
    layoutTreeComponent(
      nodeSnapshot,
      updatedEdges,
      newUpperHeadId,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  if (
    previousAdjunctParentEdge &&
    previousAdjunctParentEdge.source !==
      lowerHeadNode.id
  ) {
    balancedNodes =
      layoutTreeComponent(
        balancedNodes,
        updatedEdges,
        previousAdjunctParentEdge.source,
        showNodeBoxes,
        showHeadWordLines,
        treeLayoutMode,
        collapseUnusedBarLevels,
      );
  }

  setEdges(updatedEdges);
  setNodes(balancedNodes);
  setPendingBarAttachment(null);
}

function moveAttachedSubtree(
  targetParentNode: SyntaxNode,
  draggedNode: SyntaxNode,
  placeOnLeft: boolean,
  dragStartSnapshot:
    TreeSnapshot | null,
) {
  const previousParentEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target ===
          draggedNode.id,
    );

  if (!previousParentEdge) {
    return;
  }

  const subtreeNodeIds =
    getStructuralDescendantIds(
      draggedNode.id,
      edges,
    );

  const originalNodes =
    dragStartSnapshot?.nodes ??
    nodes;

  const originalNodeById =
    new Map(
      originalNodes.map(
        (node) => [
          node.id,
          node,
        ],
      ),
    );

  const originalRootNode =
    originalNodeById.get(
      draggedNode.id,
    );

  if (!originalRootNode) {
    return;
  }

  const lexicalYield =
    getLexicalYield(
      draggedNode.id,
      originalNodes,
      edges,
    ) || "\u2205";

  const cloneOffsetX =
    draggedNode.position.x -
    originalRootNode.position.x;

  const cloneOffsetY =
    draggedNode.position.y -
    originalRootNode.position.y;

  /*
   * Clone the complete articulated
   * structure for the higher copy.
   */
  const clonedIdByOriginalId =
    new Map<string, string>();

  for (
    const originalNodeId
    of subtreeNodeIds
  ) {
    const clonedNodeId =
      `syntax-node-${nextNodeNumber.current}`;

    nextNodeNumber.current += 1;

    clonedIdByOriginalId.set(
      originalNodeId,
      clonedNodeId,
    );
  }

  const clonedNodes:
    SyntaxNode[] = [];

  for (
    const originalNodeId
    of subtreeNodeIds
  ) {
    const originalNode =
      originalNodeById.get(
        originalNodeId,
      );

    const clonedNodeId =
      clonedIdByOriginalId.get(
        originalNodeId,
      );

    if (
      !originalNode ||
      !clonedNodeId
    ) {
      continue;
    }

    clonedNodes.push({
      id: clonedNodeId,
      type: "syntaxNode",
      position: {
        x:
          originalNode.position.x +
          cloneOffsetX,
        y:
          originalNode.position.y +
          cloneOffsetY,
      },
      data: {
        ...originalNode.data,
        isLowerCopy: false,
      },
      draggable: true,
      selected: false,
      dragging: false,
    });
  }

  const clonedTreeEdges:
    Edge[] = [];

  for (const edge of edges) {
    if (isMovementEdge(edge)) {
      continue;
    }

    if (
      !subtreeNodeIds.has(
        edge.source,
      ) ||
      !subtreeNodeIds.has(
        edge.target,
      )
    ) {
      continue;
    }

    const clonedSourceId =
      clonedIdByOriginalId.get(
        edge.source,
      );

    const clonedTargetId =
      clonedIdByOriginalId.get(
        edge.target,
      );

    if (
      !clonedSourceId ||
      !clonedTargetId
    ) {
      continue;
    }

    clonedTreeEdges.push({
      id:
        `edge-${clonedSourceId}-${clonedTargetId}`,
      source: clonedSourceId,
      target: clonedTargetId,
      sourceHandle:
        edge.sourceHandle,
      targetHandle:
        edge.targetHandle,
      type:
        edge.type ?? "straight",
      data: {
        ...edge.data,
        edgeKind: "tree",
      },
    });
  }

  const clonedRootId =
    clonedIdByOriginalId.get(
      draggedNode.id,
    );

  if (!clonedRootId) {
    return;
  }

  const isHeadAdjunctionLanding =
    targetParentNode.data.kind ===
      "head" &&
    draggedNode.data.kind ===
      "head";

  const incomingTargetHeadEdge =
    isHeadAdjunctionLanding
      ? edges.find(
          (edge) =>
            !isMovementEdge(edge) &&
            edge.target ===
              targetParentNode.id,
        )
      : undefined;

  let higherLandingNode:
    SyntaxNode | null = null;

  const higherLandingEdges:
    Edge[] = [];

  let higherLayoutStartId =
    targetParentNode.id;

  if (isHeadAdjunctionLanding) {
    const newUpperHeadId =
      `syntax-node-${nextNodeNumber.current}`;

    nextNodeNumber.current += 1;

    higherLandingNode = {
      id: newUpperHeadId,
      type: "syntaxNode",
      position: {
        ...targetParentNode.position,
      },
      data: {
        ...targetParentNode.data,
        kind: "head",
        isLowerCopy: false,
      },
    };

    higherLayoutStartId =
      newUpperHeadId;

    if (incomingTargetHeadEdge) {
      higherLandingEdges.push({
        id:
          `edge-${incomingTargetHeadEdge.source}-${newUpperHeadId}`,
        source:
          incomingTargetHeadEdge.source,
        target:
          newUpperHeadId,
        type: "straight",
        data: {
          edgeKind: "tree",
          siblingOrder:
            getSiblingOrder(
              incomingTargetHeadEdge,
            ),
        },
      });
    }

    const leftDaughterId =
      placeOnLeft
        ? clonedRootId
        : targetParentNode.id;

    const rightDaughterId =
      placeOnLeft
        ? targetParentNode.id
        : clonedRootId;

    higherLandingEdges.push(
      {
        id:
          `edge-${newUpperHeadId}-${leftDaughterId}`,
        source:
          newUpperHeadId,
        target:
          leftDaughterId,
        type: "straight",
        data: {
          edgeKind: "tree",
          siblingOrder: 0,
        },
      },
      {
        id:
          `edge-${newUpperHeadId}-${rightDaughterId}`,
        source:
          newUpperHeadId,
        target:
          rightDaughterId,
        type: "straight",
        data: {
          edgeKind: "tree",
          siblingOrder: 1,
        },
      },
    );
  } else {
    const existingSisterEdges =
      edges.filter(
        (edge) =>
          !isMovementEdge(edge) &&
          edge.source ===
            targetParentNode.id,
      );

    const existingOrders =
      existingSisterEdges.map(
        getSiblingOrder,
      );

    let siblingOrder = 0;

    if (existingOrders.length > 0) {
      siblingOrder =
        placeOnLeft
          ? Math.min(
              ...existingOrders,
            ) - 1
          : Math.max(
              ...existingOrders,
            ) + 1;
    }

    higherLandingEdges.push({
      id:
        `edge-${targetParentNode.id}-${clonedRootId}`,
      source:
        targetParentNode.id,
      target: clonedRootId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder,
      },
    });
  }

  /*
   * The lower copy retains only the
   * moved phrase label. Its former
   * articulated descendants are replaced
   * by a triangle containing the complete
   * lexical yield.
   */
  const removedLowerDescendantIds =
    new Set(
      [...subtreeNodeIds].filter(
        (nodeId) =>
          nodeId !== draggedNode.id,
      ),
    );

  const summaryNodeId =
    `syntax-node-${nextNodeNumber.current}`;

  nextNodeNumber.current += 1;

  const condensedLowerNodes =
    nodes
      .filter(
        (node) =>
          !removedLowerDescendantIds.has(
            node.id,
          ),
      )
      .map((node) => {
        if (
          node.id !== draggedNode.id
        ) {
          return node;
        }

        return {
          ...node,
          position: {
            ...originalRootNode.position,
          },
          data: {
            ...originalRootNode.data,
            isLowerCopy: true,
          },
          draggable: false,
          selected: false,
          dragging: false,
        };
      });

  const rootWidth =
    getSyntaxNodeWidth(
      originalRootNode,
    );

  const summaryWidth =
    Math.max(
      120,
      Array.from(lexicalYield).length *
        9 +
        30,
    );

  const summaryNode:
    SyntaxNode = {
    id: summaryNodeId,
    type: "syntaxNode",
    position: {
      x:
        originalRootNode.position.x +
        (rootWidth - summaryWidth) / 2,
      y:
        originalRootNode.position.y +
        52,
    },
    data: {
      label: lexicalYield,
      kind: "movementSummary",
      isLowerCopy: true,
    },
    draggable: false,
    selected: false,
    dragging: false,
  };

  /*
   * Remove the lower copy's old internal
   * branches. Existing movement arrows
   * aimed at a removed lexical terminal
   * are redirected to the new triangle.
   */
  const condensedBaseEdges =
    edges
      .filter((edge) => {
        if (isMovementEdge(edge)) {
          return true;
        }

        if (
          removedLowerDescendantIds.has(
            edge.source,
          ) ||
          removedLowerDescendantIds.has(
            edge.target,
          )
        ) {
          return false;
        }

        if (
          edge.source ===
            draggedNode.id &&
          subtreeNodeIds.has(
            edge.target,
          )
        ) {
          return false;
        }

        return true;
      })
      .map((edge): Edge => {
        if (!isMovementEdge(edge)) {
          return edge;
        }

        const sourceWasRemoved =
          removedLowerDescendantIds.has(
            edge.source,
          );

        const targetWasRemoved =
          removedLowerDescendantIds.has(
            edge.target,
          );

        if (
          !sourceWasRemoved &&
          !targetWasRemoved
        ) {
          return edge;
        }

        return {
          ...edge,
          source: sourceWasRemoved
            ? summaryNodeId
            : edge.source,
          target: targetWasRemoved
            ? summaryNodeId
            : edge.target,
          sourceHandle:
            sourceWasRemoved
              ? "movement-source"
              : edge.sourceHandle,
          targetHandle:
            targetWasRemoved
              ? "movement-target"
              : edge.targetHandle,
        };
      });

  const landingBaseEdges =
    incomingTargetHeadEdge
      ? condensedBaseEdges.filter(
          (edge) =>
            edge.id !==
            incomingTargetHeadEdge.id,
        )
      : condensedBaseEdges;

  /*
   * Keep the condensed triangle structurally
   * attached to the lower phrase so automatic
   * layout places it directly underneath.
   *
   * The edge is hidden, so no extra vertical
   * branch is drawn before the triangle.
   */
  const summaryEdge:
    Edge = {
    id:
      `edge-${draggedNode.id}-${summaryNodeId}`,
    source: draggedNode.id,
    target: summaryNodeId,
    type: "straight",
    hidden: true,
    data: {
      edgeKind: "tree",
      siblingOrder: 0,
    },
  };

  const lowerLexicalTerminalId =
    getLexicalHeadTerminalId(
      draggedNode.id,
      originalNodes,
      edges,
    );

  const higherLexicalTerminalId =
    lowerLexicalTerminalId
      ? clonedIdByOriginalId.get(
          lowerLexicalTerminalId,
        )
      : undefined;

  const movementArrow:
    Edge = {
    id:
      `movement-${summaryNodeId}-${higherLexicalTerminalId ?? clonedRootId}`,
    source: summaryNodeId,
    target:
      higherLexicalTerminalId ??
      clonedRootId,
    sourceHandle:
      "movement-source",
    targetHandle:
      "movement-target",
    type: "movement",
    data: {
      edgeKind: "movement",
    },
    markerEnd: {
      type:
        MarkerType.ArrowClosed,
      color: "#8b2f3f",
      width: 18,
      height: 18,
    },
    style: {
      stroke: "#8b2f3f",
      strokeWidth: 2.25,
      strokeDasharray: "7 4",
    },
    zIndex: 0,
    selectable: false,
  };

  const updatedNodes = [
    ...condensedLowerNodes,
    summaryNode,
    ...(
      higherLandingNode
        ? [higherLandingNode]
        : []
    ),
    ...clonedNodes,
  ];

  const updatedEdges = [
    ...landingBaseEdges,
    summaryEdge,
    ...clonedTreeEdges,
    ...higherLandingEdges,
    movementArrow,
  ];

  const balancedNodes =
    layoutTreeComponent(
      updatedNodes,
      updatedEdges,
      higherLayoutStartId,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  setNodes(balancedNodes);
  setEdges(updatedEdges);
  setPendingBarAttachment(null);
}

const handleNodeDragStop:
  OnNodeDrag<SyntaxNode> =
  (event, draggedNode) => {
    /*
     * Re-enable layout only after React Flow
     * has delivered the final pointer position.
     */
    isNodeDragActiveRef.current =
      false;

    if (!reactFlowInstance) {
      return;
    }

    const dragStartSnapshot =
      dragStartSnapshotRef.current;

    if (dragStartSnapshot) {
      pushUndoSnapshot(
        dragStartSnapshot,
      );
    }

    dragStartSnapshotRef.current =
      null;

    const intersectingNodes =
      reactFlowInstance
        .getIntersectingNodes(
          draggedNode,
          true,
        );

    const possibleParents =
      intersectingNodes.filter(
        (node) =>
          node.id !== draggedNode.id &&
          node.data.kind !== "word" &&
          node.data.kind !==
            "wordInput" &&
          !node.data.isLowerCopy,
      );

    if (
      possibleParents.length === 0
    ) {
      scheduleAutoBalance();
      return;
    }

    const draggedWidth =
      draggedNode.measured?.width ??
      getSyntaxNodeWidth(
        draggedNode,
      );

    const draggedHeight =
      draggedNode.measured?.height ??
      40;

    const draggedCentreX =
      draggedNode.position.x +
      draggedWidth / 2;

    const draggedCentreY =
      draggedNode.position.y +
      draggedHeight / 2;

    const parentNode =
      possibleParents.sort(
        (
          firstNode,
          secondNode,
        ) => {
          const firstCentreX =
            firstNode.position.x +
            getSyntaxNodeWidth(
              firstNode,
            ) /
              2;

          const firstCentreY =
            firstNode.position.y +
            (
              firstNode.measured
                ?.height ?? 40
            ) /
              2;

          const secondCentreX =
            secondNode.position.x +
            getSyntaxNodeWidth(
              secondNode,
            ) /
              2;

          const secondCentreY =
            secondNode.position.y +
            (
              secondNode.measured
                ?.height ?? 40
            ) /
              2;

          const firstDistance =
            Math.hypot(
              firstCentreX -
                draggedCentreX,
              firstCentreY -
                draggedCentreY,
            );

          const secondDistance =
            Math.hypot(
              secondCentreX -
                draggedCentreX,
              secondCentreY -
                draggedCentreY,
            );

          return (
            firstDistance -
            secondDistance
          );
        },
      )[0];

    if (
      wouldCreateCycle(
        parentNode.id,
        draggedNode.id,
        edges,
      )
    ) {
      scheduleAutoBalance();
      return;
    }

    const parentCentreX =
      parentNode.position.x +
      getSyntaxNodeWidth(
        parentNode,
      ) /
        2;

    const attachment:
      PendingBarAttachment = {
      parentId: parentNode.id,
      draggedId: draggedNode.id,
      placeOnLeft:
        draggedCentreX <
        parentCentreX,
      draggedPosition: {
        ...draggedNode.position,
      },
    };

    const previousParentEdge =
      edges.find(
        (edge) =>
          !isMovementEdge(edge) &&
          edge.target ===
            draggedNode.id,
      );

    const originalDraggedNode =
      dragStartSnapshot?.nodes.find(
        (node) =>
          node.id ===
            draggedNode.id,
      );

    const originalY =
      originalDraggedNode
        ?.position.y ??
      draggedNode.position.y;

    const targetIsHigher =
      parentNode.position.y <
      originalY;

    const targetIsDifferent =
      Boolean(
        previousParentEdge &&
        previousParentEdge.source !==
          parentNode.id,
      );

    const shouldCreateMovement =
      Boolean(
        previousParentEdge &&
        targetIsDifferent &&
        targetIsHigher &&
        !draggedNode.data
          .isLowerCopy,
      );

    if (shouldCreateMovement) {
      moveAttachedSubtree(
        parentNode,
        draggedNode,
        attachment.placeOnLeft,
        dragStartSnapshot,
      );

      return;
    }

    if (
      parentNode.data.kind ===
        "head" &&
      draggedNode.data.kind ===
        "head"
    ) {
      attachHeadAsAdjunct(
        attachment,
      );

      return;
    }

    if (
      isBarLevelLabel(
        parentNode.data.label,
      )
    ) {
      const attachmentShortcut =
        getBarAttachmentShortcut(
          event,
        );

      if (
        attachmentShortcut ===
        "complement"
      ) {
        attachDirectly(
          attachment,
        );

        return;
      }

      if (
        attachmentShortcut ===
        "adjunct"
      ) {
        attachAsAdjunct(
          attachment,
        );

        return;
      }

      setPendingBarAttachment(
        attachment,
      );

      return;
    }

    attachDirectly(attachment);
  };

  function handlePaletteDragStart(
    event: DragEvent<HTMLButtonElement>,
    item: PaletteItem,
  ) {
    event.dataTransfer.setData(
      DRAG_DATA_TYPE,
      JSON.stringify(item),
    );

    event.dataTransfer.effectAllowed =
      "copy";
  }

  function handleCanvasDragOver(
    event: DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.dataTransfer.dropEffect =
      "copy";
  }


function attachCreatedHeadAsAdjunct(
  lowerHeadNode: SyntaxNode,
  draggedHeadId: string,
  createdNodes: SyntaxNode[],
  createdEdges: Edge[],
  placeOnLeft: boolean,
  draggedPosition: {
    x: number;
    y: number;
  },
) {
  const draggedHeadNode =
    createdNodes.find(
      (node) =>
        node.id ===
        draggedHeadId,
    );

  if (
    lowerHeadNode.data.kind !==
      "head" ||
    draggedHeadNode?.data.kind !==
      "head"
  ) {
    attachCreatedSubtreeDirectly(
      lowerHeadNode,
      draggedHeadId,
      createdNodes,
      createdEdges,
      placeOnLeft,
      draggedPosition,
    );

    return;
  }

  const newUpperHeadId =
    `syntax-node-${nextNodeNumber.current}`;

  nextNodeNumber.current += 1;

  const newUpperHeadNode:
    SyntaxNode = {
    id: newUpperHeadId,
    type: "syntaxNode",
    position: {
      ...lowerHeadNode.position,
    },
    data: {
      ...lowerHeadNode.data,
      kind: "head",
      isLowerCopy: false,
    },
  };

  const nodeSnapshot = [
    ...nodes,
    ...createdNodes,
    newUpperHeadNode,
  ].map((node) => {
    if (
      node.id !== draggedHeadId
    ) {
      return node;
    }

    return {
      ...node,
      position: {
        ...draggedPosition,
      },
    };
  });

  const incomingHeadEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target ===
          lowerHeadNode.id,
    );

  let updatedEdges = [
    ...edges,
    ...createdEdges,
  ].filter(
    (edge) =>
      !incomingHeadEdge ||
      edge.id !==
        incomingHeadEdge.id,
  );

  if (incomingHeadEdge) {
    updatedEdges = addEdge(
      {
        id:
          `edge-${incomingHeadEdge.source}-${newUpperHeadId}`,
        source:
          incomingHeadEdge.source,
        target:
          newUpperHeadId,
        type: "straight",
        data: {
          edgeKind: "tree",
          siblingOrder:
            getSiblingOrder(
              incomingHeadEdge,
            ),
        },
      },
      updatedEdges,
    );
  }

  const leftDaughterId =
    placeOnLeft
      ? draggedHeadId
      : lowerHeadNode.id;

  const rightDaughterId =
    placeOnLeft
      ? lowerHeadNode.id
      : draggedHeadId;

  updatedEdges = addEdge(
    {
      id:
        `edge-${newUpperHeadId}-${leftDaughterId}`,
      source:
        newUpperHeadId,
      target:
        leftDaughterId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder: 0,
      },
    },
    updatedEdges,
  );

  updatedEdges = addEdge(
    {
      id:
        `edge-${newUpperHeadId}-${rightDaughterId}`,
      source:
        newUpperHeadId,
      target:
        rightDaughterId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder: 1,
      },
    },
    updatedEdges,
  );

  const balancedNodes =
    layoutTreeComponent(
      nodeSnapshot,
      updatedEdges,
      newUpperHeadId,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  setNodes(balancedNodes);
  setEdges(updatedEdges);
}

  function attachCreatedSubtreeAsAdjunct(
  lowerBarNode: SyntaxNode,
  draggedRootId: string,
  createdNodes: SyntaxNode[],
  createdEdges: Edge[],
  placeOnLeft: boolean,
  draggedPosition: {
    x: number;
    y: number;
  },
) {
  const draggedRootNode =
    createdNodes.find(
      (node) =>
        node.id ===
        draggedRootId,
    );

  if (
    !draggedRootNode ||
    !isBarLevelLabel(
      lowerBarNode.data.label,
    )
  ) {
    attachCreatedSubtreeDirectly(
      lowerBarNode,
      draggedRootId,
      createdNodes,
      createdEdges,
      placeOnLeft,
      draggedPosition,
    );

    return;
  }

  const incomingBarEdge =
    edges.find(
      (edge) =>
        !isMovementEdge(edge) &&
        edge.target ===
          lowerBarNode.id,
    );

  const newUpperBarId =
    `syntax-node-${nextNodeNumber.current}`;

  nextNodeNumber.current += 1;

  const newUpperBarNode:
    SyntaxNode = {
    id: newUpperBarId,
    type: "syntaxNode",
    position: {
      ...lowerBarNode.position,
    },
    data: {
      ...lowerBarNode.data,
      kind: "phrase",
      isLowerCopy: false,
    },
  };

  const nodeSnapshot = [
    ...nodes,
    ...createdNodes,
    newUpperBarNode,
  ].map((node) => {
    if (
      node.id !== draggedRootId
    ) {
      return node;
    }

    return {
      ...node,
      position: {
        ...draggedPosition,
      },
    };
  });

  let updatedEdges = [
    ...edges,
    ...createdEdges,
  ].filter(
    (edge) =>
      !incomingBarEdge ||
      edge.id !==
        incomingBarEdge.id,
  );

  if (incomingBarEdge) {
    updatedEdges = addEdge(
      {
        id:
          `edge-${incomingBarEdge.source}-${newUpperBarId}`,
        source:
          incomingBarEdge.source,
        target:
          newUpperBarId,
        type: "straight",
        data: {
          edgeKind: "tree",
          siblingOrder:
            getSiblingOrder(
              incomingBarEdge,
            ),
        },
      },
      updatedEdges,
    );
  }

  const leftDaughterId =
    placeOnLeft
      ? draggedRootId
      : lowerBarNode.id;

  const rightDaughterId =
    placeOnLeft
      ? lowerBarNode.id
      : draggedRootId;

  updatedEdges = addEdge(
    {
      id:
        `edge-${newUpperBarId}-${leftDaughterId}`,
      source:
        newUpperBarId,
      target:
        leftDaughterId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder: 0,
      },
    },
    updatedEdges,
  );

  updatedEdges = addEdge(
    {
      id:
        `edge-${newUpperBarId}-${rightDaughterId}`,
      source:
        newUpperBarId,
      target:
        rightDaughterId,
      type: "straight",
      data: {
        edgeKind: "tree",
        siblingOrder: 1,
      },
    },
    updatedEdges,
  );

  const balancedNodes =
    layoutTreeComponent(
      nodeSnapshot,
      updatedEdges,
      newUpperBarId,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  setNodes(balancedNodes);
  setEdges(updatedEdges);
  setPendingBarAttachment(null);
}

  function attachCreatedSubtreeDirectly(
  parentNode: SyntaxNode,
  draggedRootId: string,
  createdNodes: SyntaxNode[],
  createdEdges: Edge[],
  placeOnLeft: boolean,
  draggedPosition: {
    x: number;
    y: number;
  },
) {
  const nodeSnapshot = [
    ...nodes,
    ...createdNodes,
  ].map((node) => {
    if (node.id !== draggedRootId) {
      return node;
    }

    return {
      ...node,
      position: draggedPosition,
    };
  });

  const edgeSnapshot = [
    ...edges,
    ...createdEdges,
  ];

  const existingSisterEdges =
  edgeSnapshot.filter(
    (edge) =>
      !isMovementEdge(edge) &&
      edge.source ===
        parentNode.id,
  );

  const existingOrders =
    existingSisterEdges.map(
      getSiblingOrder,
    );

  let newSiblingOrder = 0;

  if (existingOrders.length > 0) {
    newSiblingOrder =
      placeOnLeft
        ? Math.min(...existingOrders) - 1
        : Math.max(...existingOrders) + 1;
  }

  const updatedEdges = addEdge(
    {
      id:
        `edge-${parentNode.id}-${draggedRootId}`,
      source: parentNode.id,
      target: draggedRootId,
      type: "straight",
      data: {
        siblingOrder: newSiblingOrder,
      },
    },
    edgeSnapshot,
  );

  const balancedNodes =
    layoutTreeComponent(
      nodeSnapshot,
      updatedEdges,
      parentNode.id,
      showNodeBoxes,
      showHeadWordLines,
      treeLayoutMode,
      collapseUnusedBarLevels,
    );

  setNodes(balancedNodes);
  setEdges(updatedEdges);
}

  function handleCanvasDrop(
  event: DragEvent<HTMLDivElement>,
) {
  event.preventDefault();

  if (!reactFlowInstance) {
    return;
  }

  const savedItem =
    event.dataTransfer.getData(
      DRAG_DATA_TYPE,
    );

  if (!savedItem) {
    return;
  }

  try {
    const item = JSON.parse(
      savedItem,
    ) as PaletteItem;

    const dropPosition =
      reactFlowInstance
        .screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

    const placementLevelGap =
      showNodeBoxes
        ? LEVEL_GAP
        : BOXLESS_LEVEL_GAP;

    saveUndoSnapshot();
    /*
     * Check the existing canvas before
     * adding the new nodes.
     */
    const targetNode =
      getNodeAtFlowPosition(
        dropPosition,
        nodes,
      );

    const createdNodes: SyntaxNode[] =
      [];

    const createdEdges: Edge[] = [];

    let draggedRootId = "";

    /*
     * Create an XP → X′ → X → word chain.
     */
    if (
      item.kind === "phrase" &&
      isMaximalProjection(item.label)
    ) {
      const [
        phraseLabel,
        intermediateLabel,
        headLabel,
      ] = projectionChains[item.label];

      const firstNodeNumber =
        nextNodeNumber.current;

      const phraseId =
        `syntax-node-${firstNodeNumber}`;

      const intermediateId =
        `syntax-node-${firstNodeNumber + 1}`;

      const headId =
        `syntax-node-${firstNodeNumber + 2}`;

      const wordInputId =
        `syntax-node-${firstNodeNumber + 3}`;

      const defaultLexicalLabel =
        getDefaultLexicalLabelForHead(
          headLabel,
        );

      nextNodeNumber.current += 4;

      draggedRootId = phraseId;

      createdNodes.push(
        {
          id: phraseId,
          type: "syntaxNode",
          position: {
            x: dropPosition.x,
            y: dropPosition.y,
          },
          data: {
            label: phraseLabel,
            kind: "phrase",
          },
        },
        {
          id: intermediateId,
          type: "syntaxNode",
          position: {
            x: dropPosition.x,
            y:
              dropPosition.y +
              placementLevelGap,
          },
          data: {
            label: intermediateLabel,
            kind: "phrase",
          },
        },
        {
          id: headId,
          type: "syntaxNode",
          position: {
            x: dropPosition.x,
            y:
              dropPosition.y +
              placementLevelGap * 2,
          },
          data: {
            label: headLabel,
            kind: "head",
          },
        },
        {
          id: wordInputId,
          type: "syntaxNode",
          position: {
            x: dropPosition.x,
            y:
              dropPosition.y +
              placementLevelGap * 3,
          },
          data: {
            label:
              defaultLexicalLabel,
            kind: "wordInput",
          },
        },
      );

      createdEdges.push(
        {
          id:
            `edge-${phraseId}-${intermediateId}`,
          source: phraseId,
          target: intermediateId,
          type: "straight",
          data: {
            siblingOrder: 0,
          },
        },
        {
          id:
            `edge-${intermediateId}-${headId}`,
          source: intermediateId,
          target: headId,
          type: "straight",
          data: {
            siblingOrder: 0,
          },
        },
        {
          id:
            `edge-${headId}-${wordInputId}`,
          source: headId,
          target: wordInputId,
          type: "straight",
          data: {
            siblingOrder: 0,
          },
        },
      );
    } else if (item.kind === "head") {
      /*
       * Create an individual head with a
       * blank lexical daughter.
       */
      const firstNodeNumber =
        nextNodeNumber.current;

      const headId =
        `syntax-node-${firstNodeNumber}`;

      const wordInputId =
        `syntax-node-${firstNodeNumber + 1}`;

      const defaultLexicalLabel =
        getDefaultLexicalLabelForHead(
          item.label,
        );

      nextNodeNumber.current += 2;

      draggedRootId = headId;

      createdNodes.push(
        {
          id: headId,
          type: "syntaxNode",
          position: {
            x: dropPosition.x,
            y: dropPosition.y,
          },
          data: {
            label: item.label,
            kind: "head",
          },
        },
        {
          id: wordInputId,
          type: "syntaxNode",
          position: {
            x: dropPosition.x,
            y:
              dropPosition.y +
              placementLevelGap,
          },
          data: {
            label:
              defaultLexicalLabel,
            kind: "wordInput",
          },
        },
      );

      createdEdges.push({
        id:
          `edge-${headId}-${wordInputId}`,
        source: headId,
        target: wordInputId,
        type: "straight",
        data: {
          siblingOrder: 0,
        },
      });
    } else {
      /*
       * Fallback for any individual
       * palette item.
       */
      const nodeId =
        `syntax-node-${nextNodeNumber.current}`;

      nextNodeNumber.current += 1;

      draggedRootId = nodeId;

      createdNodes.push({
        id: nodeId,
        type: "syntaxNode",
        position: dropPosition,
        data: {
          label: item.label,
          kind: item.kind,
        },
      });
    }

    /*
     * Empty-canvas drop: keep the new
     * subtree separate.
     */
    if (!targetNode) {
      const updatedNodes = [
        ...nodes,
        ...createdNodes,
      ];

      const updatedEdges = [
        ...edges,
        ...createdEdges,
      ];

      const balancedNodes =
        layoutTreeComponent(
          updatedNodes,
          updatedEdges,
          draggedRootId,
          showNodeBoxes,
          showHeadWordLines,
          treeLayoutMode,
          collapseUnusedBarLevels,
        );

      setNodes(balancedNodes);
      setEdges(updatedEdges);

      return;
    }

    const targetCentreX =
      targetNode.position.x +
      (
        targetNode.measured?.width ??
        getSyntaxNodeWidth(targetNode)
      ) /
        2;

    const placeOnLeft =
      dropPosition.x <
      targetCentreX;

    const draggedRootNode =
      createdNodes.find(
        (node) =>
          node.id === draggedRootId,
      );

    const draggedPosition =
      draggedRootNode?.position ??
      dropPosition;

    /*
     * A head attached to another head is
     * automatically treated as head
     * adjunction. For example, dropping T
     * on the left side of C produces:
     *
     * [C [T C]]
     */
    if (
      targetNode.data.kind ===
        "head" &&
      draggedRootNode?.data.kind ===
        "head"
    ) {
      attachCreatedHeadAsAdjunct(
        targetNode,
        draggedRootId,
        createdNodes,
        createdEdges,
        placeOnLeft,
        draggedPosition,
      );

      return;
    }

    /*
     * X′ targets use modifier-key shortcuts
     * when Ctrl/Command or Alt is held.
     * Without a modifier, retain the dialog.
     */
    if (
      isBarLevelLabel(
        targetNode.data.label,
      )
    ) {
      const attachmentShortcut =
        getBarAttachmentShortcut(
          event,
        );

      if (
        attachmentShortcut ===
        "complement"
      ) {
        attachCreatedSubtreeDirectly(
          targetNode,
          draggedRootId,
          createdNodes,
          createdEdges,
          placeOnLeft,
          draggedPosition,
        );

        return;
      }

      if (
        attachmentShortcut ===
        "adjunct"
      ) {
        attachCreatedSubtreeAsAdjunct(
          targetNode,
          draggedRootId,
          createdNodes,
          createdEdges,
          placeOnLeft,
          draggedPosition,
        );

        return;
      }

      setNodes((currentNodes) => [
        ...currentNodes,
        ...createdNodes,
      ]);

      setEdges((currentEdges) => [
        ...currentEdges,
        ...createdEdges,
      ]);

      setPendingBarAttachment({
        parentId: targetNode.id,
        draggedId: draggedRootId,
        placeOnLeft,
        draggedPosition,
      });

      return;
    }

    /*
     * Other targets attach immediately.
     */
    attachCreatedSubtreeDirectly(
      targetNode,
      draggedRootId,
      createdNodes,
      createdEdges,
      placeOnLeft,
      draggedPosition,
    );
  } catch {
    // Ignore invalid drag information.
  }
}

  function loadDemoTree() {
    /*
     * Loading the demo replaces the current
     * canvas, but remains undoable.
     */
    saveUndoSnapshot();

    cancelScheduledAutoBalance();

    const demoSession =
      createDemoTreeSession();

    nextNodeNumber.current =
      demoSession.nextNodeNumber;

    setPendingBarAttachment(null);
    setSelectionBoxActive(false);

    setShowNodeBoxes(false);
    setShowMovementArrows(true);
    setShowHeadWordLines(true);
    setTreeLayoutMode("topDown");
    setCollapseUnusedBarLevels(false);

    setNodes(
      demoSession.nodes,
    );

    setEdges(
      demoSession.edges,
    );

    /*
     * Fit the complete demonstration tree
     * after React Flow has rendered it.
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        reactFlowInstance?.fitView({
          padding: 0.08,
          duration: 300,
        });
      });
    });
  }

  function clearCanvas() {
  if (
    nodes.length === 0 &&
    edges.length === 0
  ) {
    return;
  }

  saveUndoSnapshot();

  setNodes([]);
  setEdges([]);

  setPendingBarAttachment(null);
}

  const deleteSelected =
  useCallback(() => {
    const deletionResult =
      deleteSelectionAndPromoteDaughters(
        nodes,
        edges,
      );

    if (!deletionResult.changed) {
      return;
    }

    saveUndoSnapshot();

    setPendingBarAttachment(null);

    setNodes(
      deletionResult.nodes,
    );

    setEdges(
      deletionResult.edges,
    );

    requestAnimationFrame(() => {
      scheduleAutoBalance();
    });
  }, [
    edges,
    nodes,
    saveUndoSnapshot,
    scheduleAutoBalance,
    setEdges,
    setNodes,
  ]);

  useEffect(() => {
    function handleDeleteShortcut(
      event: KeyboardEvent,
    ) {
      if (
        event.key !== "Delete" &&
        event.key !== "Backspace"
      ) {
        return;
      }

      const target =
        event.target;

      const isEditingText =
        target instanceof
          HTMLInputElement ||
        target instanceof
          HTMLTextAreaElement ||
        (
          target instanceof
            HTMLElement &&
          target.isContentEditable
        );

      if (isEditingText) {
        return;
      }

      const hasSelection =
        nodes.some(
          (node) => node.selected,
        ) ||
        edges.some(
          (edge) => edge.selected,
        );

      if (!hasSelection) {
        return;
      }

      event.preventDefault();

      deleteSelected();
    }

    window.addEventListener(
      "keydown",
      handleDeleteShortcut,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleDeleteShortcut,
      );
    };
  }, [
    deleteSelected,
    edges,
    nodes,
  ]);


  async function exportTreeAsPng() {
  if (displayedNodes.length === 0) {
    alert(
      "Add at least one node before exporting.",
    );

    return;
  }

  const viewportElement =
    flowCanvasRef.current
      ?.querySelector<HTMLElement>(
        ".react-flow__viewport",
      );

  if (!viewportElement) {
    alert(
      "The tree canvas could not be found.",
    );

    return;
  }

  if (
    document.activeElement
      instanceof HTMLElement
  ) {
    document.activeElement.blur();
  }

  /*
   * Small amount of space around the tree
   * so node borders and branch lines are
   * not clipped.
   */
  const hasMovementArrow =
    showMovementArrows &&
    edges.some(isMovementEdge);

  const imagePadding =
    hasMovementArrow
      ? 130
      : 10;

  const nodesBounds =
    getNodesBounds(
      displayedNodes,
    );

  const imageWidth =
    Math.ceil(
      nodesBounds.width +
      imagePadding * 2,
    );

  const imageHeight =
    Math.ceil(
      nodesBounds.height +
      imagePadding * 2,
    );

  /*
   * Move the upper-left corner of the
   * tree to the image padding boundary.
   */
  const translateX =
    imagePadding -
    nodesBounds.x;

  const translateY =
    imagePadding -
    nodesBounds.y;

  flowCanvasRef.current?.classList.add(
    "exporting-tree",
  );

  try {
    await waitForTreePaint();

    const dataUrl =
      await toPng(
        viewportElement,
        {
          backgroundColor:
            "#ffffff",

          width: imageWidth,
          height: imageHeight,

          pixelRatio: 2,
          cacheBust: true,

          style: {
            width:
              `${imageWidth}px`,

            height:
              `${imageHeight}px`,

            transformOrigin:
              "0 0",

            transform:
              `translate(${translateX}px, ${translateY}px)`,
          },
        },
      );

    downloadDataUrl(
      dataUrl,
      "xbar-tree.png",
    );
  } catch (error) {
    console.error(error);

    alert(
      "The PNG could not be created.",
    );
  } finally {
    flowCanvasRef.current
      ?.classList.remove(
        "exporting-tree",
      );
  }
}

function exportTreeAsLatex() {
  try {
    const latexDocument =
      createLatexDocument(
        collapsedDisplayStructure
          .nodes,
        collapsedDisplayStructure
          .edges,
        showNodeBoxes,
        showMovementArrows,
        showHeadWordLines,
      );

    downloadTextFile(
      latexDocument,
      "xbar-tree.tex",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The LaTeX file could not be created.";

    alert(message);
  }
}

  const selectedHeadNodes =
    useMemo(
      () =>
        nodes.filter(
          (node) =>
            node.selected &&
            node.data.kind ===
              "head" &&
            !node.data.isLowerCopy,
        ),
      [nodes],
    );

  const selectedFormattableNodes =
    useMemo(
      () =>
        nodes.filter(
          (node) =>
            node.selected &&
            node.data.kind !==
              "movementSummary",
        ),
      [nodes],
    );

  function addBlankLexicalBoxes() {
    if (
      selectedHeadNodes.length === 0
    ) {
      return;
    }

    saveUndoSnapshot();

    const placementLevelGap =
      showNodeBoxes
        ? LEVEL_GAP
        : BOXLESS_LEVEL_GAP;

    const createdNodes:
      SyntaxNode[] = [];

    const createdEdges:
      Edge[] = [];

    for (
      const headNode
      of selectedHeadNodes
    ) {
      const existingChildEdges =
        edges.filter(
          (edge) =>
            !isMovementEdge(edge) &&
            edge.source ===
              headNode.id,
        );

      const existingSiblingOrders =
        existingChildEdges.map(
          getSiblingOrder,
        );

      const newSiblingOrder =
        existingSiblingOrders.length > 0
          ? Math.max(
              ...existingSiblingOrders,
            ) + 1
          : 0;

      const lexicalNodeId =
        `syntax-node-${nextNodeNumber.current}`;

      nextNodeNumber.current += 1;

      createdNodes.push({
        id: lexicalNodeId,
        type: "syntaxNode",
        position: {
          x:
            headNode.position.x +
            newSiblingOrder * 28,
          y:
            headNode.position.y +
            placementLevelGap,
        },
        data: {
          label: "",
          kind: "wordInput",
        },
        selected: false,
        dragging: false,
      });

      createdEdges.push({
        id:
          `edge-${headNode.id}-${lexicalNodeId}`,
        source: headNode.id,
        target: lexicalNodeId,
        type: "tree",
        data: {
          edgeKind: "tree",
          siblingOrder:
            newSiblingOrder,
        },
      });
    }

    setNodes([
      ...nodes,
      ...createdNodes,
    ]);

    setEdges([
      ...edges,
      ...createdEdges,
    ]);

    /*
     * The temporary positions make the new
     * boxes visible immediately. The normal
     * two-frame balancer then measures and
     * places all lexical daughters evenly.
     */
    requestAnimationFrame(() => {
      scheduleAutoBalance();
    });
  }

  const selectedNodesAreBold =
    selectedFormattableNodes.length >
      0 &&
    selectedFormattableNodes.every(
      (node) =>
        isNodeTextBold(
          node.data,
        ),
    );

  const selectedNodesAreItalic =
    selectedFormattableNodes.length >
      0 &&
    selectedFormattableNodes.every(
      (node) =>
        Boolean(
          node.data.textItalic,
        ),
    );

  const selectedNodesAreStruck =
    selectedFormattableNodes.length >
      0 &&
    selectedFormattableNodes.every(
      (node) =>
        Boolean(
          node.data
            .textStrikethrough,
        ),
    );

  function toggleSelectedTextFormat(
    formatKey: TextFormatKey,
  ) {
    if (
      selectedFormattableNodes.length ===
      0
    ) {
      return;
    }

    const selectedNodeIds =
      new Set(
        selectedFormattableNodes.map(
          (node) => node.id,
        ),
      );

    const shouldEnable =
      !selectedFormattableNodes.every(
        (node) =>
          getNodeTextFormatState(
            node.data,
            formatKey,
          ),
      );

    saveUndoSnapshot();

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        selectedNodeIds.has(
          node.id,
        )
          ? {
              ...node,
              data: {
                ...node.data,
                [formatKey]:
                  shouldEnable,
              },
            }
          : node,
      ),
    );

    requestAnimationFrame(() => {
      scheduleAutoBalance();
    });
  }

  useEffect(() => {
    function handleFormattingShortcut(
      event: KeyboardEvent,
    ) {
      if (
        event.repeat ||
        event.altKey ||
        !(
          event.ctrlKey ||
          event.metaKey
        )
      ) {
        return;
      }

      const shortcutKey =
        event.key.toLowerCase();

      if (
        shortcutKey !== "b" &&
        shortcutKey !== "i"
      ) {
        return;
      }

      if (
        selectedFormattableNodes.length ===
        0
      ) {
        return;
      }

      event.preventDefault();

      toggleSelectedTextFormat(
        shortcutKey === "b"
          ? "textBold"
          : "textItalic",
      );
    }

    window.addEventListener(
      "keydown",
      handleFormattingShortcut,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleFormattingShortcut,
      );
    };
  }, [
    selectedFormattableNodes,
    toggleSelectedTextFormat,
  ]);

  const formattingButtonBaseStyle:
    CSSProperties = {
    width: 34,
    minWidth: 34,
    height: 34,
    padding: 0,
    display: "inline-grid",
    placeItems: "center",
    border:
      "1px solid #c7ccd4",
    borderRadius: 6,
    cursor:
      selectedFormattableNodes
        .length > 0
        ? "pointer"
        : "not-allowed",
  };

  const collapsedDisplayStructure =
    useMemo(
      () =>
        createCollapsedBarStructure(
          nodes,
          edges,
          collapseUnusedBarLevels,
        ),
      [
        collapseUnusedBarLevels,
        edges,
        nodes,
      ],
    );

  const displayedNodes =
    collapsedDisplayStructure.nodes;

  const displayedEdges =
    useMemo(
      () =>
        collapsedDisplayStructure
          .edges.map((edge) => {
            const movementEdge =
              isMovementEdge(edge);

            return {
              ...edge,
              type:
                movementEdge
                  ? (
                      edge.type ??
                      "movement"
                    )
                  : "tree",
              /*
               * The TreeEdge component owns
               * structural line appearance.
               * Do not allow a promoted,
               * collapsed, selected, or
               * manually created edge to
               * carry a different width.
               */
              style:
                movementEdge
                  ? edge.style
                  : undefined,
              hidden:
                Boolean(edge.hidden) ||
                (
                  !showHeadWordLines &&
                  isHeadToLexicalEdge(
                    edge,
                    displayedNodes,
                  )
                ),
            };
          }),
      [
        collapsedDisplayStructure,
        displayedNodes,
        showHeadWordLines,
      ],
    );


  return (
    <div className="tree-builder">
      <aside className="node-palette">
        <header className="palette-header">
          <h1>X-Bar Tree Builder</h1>

          <p>
            Drag labels and words onto the
            canvas.
          </p>
        </header>

        <section className="palette-section">
          <h2>Phrase labels</h2>

          <div className="palette-grid">
            {phraseLabels.map(
              (item) => (
                <PaletteCard
                  item={item}
                  key={item.label}
                  onDragStart={
                    handlePaletteDragStart
                  }
                />
              ),
            )}
          </div>
        </section>

        <section className="palette-section">
          <h2>Heads</h2>

          <div className="palette-grid">
            {headLabels.map((item) => (
              <PaletteCard
                item={item}
                key={item.label}
                onDragStart={
                  handlePaletteDragStart
                }
              />
            ))}
          </div>
        </section>

        

        <section className="instructions">
  <h2>How to use the tree builder</h2>

  <details open>
    <summary>
      Add phrases and heads
    </summary>

    <ul>
      <li>
        Drag a phrase label from the
        sidebar to create its complete
        projection chain.
      </li>

      <li>
        For example, dragging NP creates
        NP, N′, N, and a blank lexical
        terminal.
      </li>

      <li>
        Drag a head label to create the
        head and a blank lexical terminal
        beneath it.
      </li>

      <li>
        To create a split head, select an
        existing head and click Add lexical
        box at the upper-left of the canvas.
      </li>

      <li>
        Each click adds another blank
        lexical daughter on the right side
        of that head. Multiple selected
        heads receive one new lexical box
        each.
      </li>

      <li>
        The new lexical boxes participate
        in Tab navigation, balancing, PNG
        export, and LaTeX export.
      </li>

      <li>
        Click DEMO in the upper-right of
        the canvas to replace the current
        tree with the built-in demonstration
        tree, including the two NP
        movement arrows. The replacement
        can be undone.
      </li>

      <li>
        The demonstration tree appears
        automatically the first time the
        app is opened in a browser.
      </li>

      <li>
        Drop an item on empty canvas
        space to create a separate
        subtree.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Attach a new subtree
    </summary>

    <ul>
      <li>
        Drag a phrase or head directly
        from the sidebar onto an existing
        node to create and attach it in
        one step.
      </li>

      <li>
        Drop it on the left side of the
        parent to make it the left
        daughter.
      </li>

      <li>
        Drop it on the right side of the
        parent to make it the right
        daughter.
      </li>

      <li>
        The complete tree automatically
        rebalances after nodes are created,
        attached, edited, or moved.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Move and reattach existing nodes
    </summary>

    <ul>
      <li>
        Drag an existing node or subtree
        onto another node to attach it as
        a daughter.
      </li>

      <li>
        Dropping on the left or right
        side determines its position
        among the other daughters.
      </li>

      <li>
        A node can have only one parent.
        Reattaching it removes its earlier
        parent connection.
      </li>

      <li>
        Circular attachments are blocked.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Complements and adjuncts
    </summary>

    <ul>
      <li>
        Dropping a node onto an X′ level
        opens a Complement or Adjunct
        choice when no modifier key is
        held.
      </li>

      <li>
        Hold Ctrl while releasing on an
        X′ level to attach immediately as
        a complement. Command works as the
        equivalent shortcut on macOS.
      </li>

      <li>
        Hold Alt while releasing on an
        X′ level to attach immediately as
        an adjunct.
      </li>

      <li>
        A complement becomes a direct
        daughter of the existing X′ and
        a sister of the head.
      </li>

      <li>
        An adjunct creates a new X′ level
        above the existing X′.
      </li>

      <li>
        The adjunct and the lower X′
        become sisters under the newly
        created X′.
      </li>

      <li>
        The side on which the adjunct is
        dropped determines whether it
        appears on the left or right.
      </li>

      <li>
        Attaching one lexical head directly
        to another lexical head is treated
        automatically as head adjunction;
        no dialog appears.
      </li>

      <li>
        The target head is copied as a new
        upper head, while the original
        target head remains as the lower
        daughter.
      </li>

      <li>
        For example, attaching T on the
        left side of C produces the
        bracket structure [C [T C]].
      </li>

      <li>
        When an already attached head moves
        upward to another head, the higher
        landing site uses the same
        head-adjunction structure while the
        lower copy and movement arrow are
        preserved.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Edit node labels and words
    </summary>

    <ul>
      <li>
        Double-click any node to edit its
        label.
      </li>

      <li>
        Double-click a lexical terminal to
        enter or replace its content.
      </li>

      <li>
        New C and T heads use ∅ as their
        default lexical content. Clicking
        or tabbing into that box selects
        the symbol so typing replaces it.
      </li>

      <li>
        While editing a lexical box,
        press Tab to open the next lexical
        box from left to right and begin
        typing immediately.
      </li>

      <li>
        Press Shift+Tab to move to the
        previous lexical box.
      </li>

      <li>
        Select one or more boxes and use
        the B, I, and S controls at the
        upper-left corner of the canvas to
        toggle bold, italics, and
        strikethrough.
      </li>

      <li>
        Press Ctrl+B for bold or Ctrl+I
        for italics. Command+B and
        Command+I are also supported on
        macOS.
      </li>

      <li>
        While editing, press Shift+Enter
        to insert a new line inside the
        same box.
      </li>

      <li>
        The node expands automatically as
        text or additional lines are
        entered.
      </li>

      <li>
        Press Enter without Shift, press
        Escape, or click outside the node
        to finish editing.
      </li>

      <li>
        The tree rebalances after an edit
        changes a node’s width.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Connect nodes manually
    </summary>

    <ul>
      <li>
        Drag from the circle at the bottom
        of a parent node.
      </li>

      <li>
        Release on the circle at the top
        of the intended daughter.
      </li>

      <li>
        Manual connections are useful for
        structures that are not created
        through automatic attachment.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Navigate the canvas
    </summary>

    <ul>
      <li>
        Drag empty canvas space to pan
        across the workspace.
      </li>

      <li>
        Use the mouse wheel or the canvas
        controls to zoom.
      </li>

      <li>
        Use the fit-view control to bring
        the complete tree back into view.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Delete and clear
    </summary>

    <ul>
      <li>
        Use Select box at the upper-left
        of the canvas, then drag across
        empty canvas space to select
        several nodes at once.
      </li>

      <li>
        While Select box is active, canvas
        panning and node dragging are
        temporarily disabled. Turn it off
        to move nodes again.
      </li>

      <li>
        Click a node or branch line to
        select an individual item.
      </li>

      <li>
        Press Delete or Backspace, or use
        Delete selected in the toolbar.
      </li>

      <li>
        When selected nodes are removed,
        each surviving daughter below the
        deleted region is promoted to the
        nearest surviving parent above the
        highest deleted node.
      </li>

      <li>
        Daughter order is preserved when
        several promoted subtrees replace
        one deleted node.
      </li>

      <li>
        Clear canvas removes every node
        and branch from the workspace.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Choose top-down or bottom-up layout
    </summary>

    <ul>
      <li>
        Use the Tree layout menu in the
        toolbar to choose Top-down or
        Bottom-up.
      </li>

      <li>
        Top-down keeps every node at a
        regular depth below the root.
      </li>

      <li>
        Bottom-up places all lexical words
        on one shared terminal row and
        staggers the remaining structure
        upward from those words.
      </li>

      <li>
        Changing the menu immediately
        rebalances the complete tree.
      </li>

      <li>
        New nodes, attachments, movement,
        editing, and restored sessions use
        the selected layout mode.
      </li>

      <li>
        PNG and LaTeX exports preserve the
        currently displayed layout.
      </li>

      <li>
        The selected layout is remembered
        when the page is reopened.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Show or hide label boxes
    </summary>

    <ul>
      <li>
        The display controls are located
        at the upper-right corner of the
        canvas.
      </li>

      <li>
        Keep Show boxes checked to display
        boxes around every phrase,
        category, and lexical word.
      </li>

      <li>
        Clear Show boxes to display only
        labels, structural lines,
        triangles, and movement arrows.
        Branch spacing becomes more compact
        and lines attach closer to labels.
      </li>

      <li>
        PNG and LaTeX exports use the
        currently selected box setting.
      </li>

      <li>
        The box setting is remembered when
        the page is reopened.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Show or hide movement arrows
    </summary>

    <ul>
      <li>
        Keep Show movement arrows checked
        to display curved dashed arrows
        between lower and higher copies.
      </li>

      <li>
        Clear Show movement arrows to hide
        every movement arrow without
        deleting movement structure or
        condensed lower copies.
      </li>

      <li>
        PNG and LaTeX exports use the
        currently selected arrow setting.
      </li>

      <li>
        The arrow setting is remembered
        when the page is reopened.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Show or hide head-word lines
    </summary>

    <ul>
      <li>
        Keep Show head-word lines checked
        to draw the vertical structural
        line between a head such as N and
        its lexical word.
      </li>

      <li>
        Clear Show head-word lines to hide
        that line and place the lexical
        word directly beneath its head.
      </li>

      <li>
        The hidden line remains part of
        the tree structure, so movement,
        balancing, undo, and editing still
        work normally.
      </li>

      <li>
        PNG and LaTeX exports use the
        currently selected setting.
      </li>

      <li>
        The setting is remembered when
        the page is reopened.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Remove unused bar levels
    </summary>

    <ul>
      <li>
        Check Remove unused bar levels to
        hide an X′ node when it has only
        one daughter.
      </li>

      <li>
        An X′ node is also hidden when it
        is the only daughter of its parent,
        even when the X′ itself has two or
        more daughters.
      </li>

      <li>
        The X′ node must have a parent.
        Root bar levels are not removed.
      </li>

      <li>
        Every daughter of the removed X′
        is promoted directly to its parent,
        with left-to-right order preserved.
      </li>

      <li>
        A branching X′ remains visible only
        when it also has a sister under its
        parent.
      </li>

      <li>
        Uncheck the option to restore the
        original bar levels and branches.
        The underlying tree is not
        permanently deleted.
      </li>

      <li>
        Automatic balancing, PNG export,
        and LaTeX export use the selected
        setting.
      </li>

      <li>
        Structural branch lines keep the
        same fixed thickness when bar
        levels are hidden, nodes are
        deleted, or daughters are
        promoted.
      </li>

      <li>
        The setting is remembered when
        the page is reopened.
      </li>
    </ul>
  </details>

  <details>
    <summary>
      Export the tree
    </summary>

    <ul>
      <li>
        Export PNG downloads a clean image
        of the complete tree.
      </li>

      <li>
        Selection outlines and connection
        handles are hidden in the exported
        PNG.
      </li>

      <li>
        Export LaTeX downloads a complete
        standalone TikZ document that
        preserves node positions, lower
        copies, triangles, strikeout, and
        movement arrows.
      </li>

      <li>
        Sister order in the LaTeX output
        follows the visual left-to-right
        order of the tree.
      </li>

      <li>
        Disconnected trees are exported as
        separate \Tree commands.
      </li>
    </ul>
  </details>

  <details>
  <summary>
    Automatic session saving
  </summary>

  <ul>
    <li>
      The current tree is saved
      automatically in this browser.
    </li>

    <li>
      Closing or refreshing the page
      does not remove the tree.
    </li>

    <li>
      Reopening the tree builder restores
      the saved nodes, labels, branches,
      and positions.
    </li>

    <li>
      Clear canvas permanently replaces
      the saved tree with an empty canvas.
    </li>
  </ul>
</details>
</section>
      </aside>

      <main className="workspace">
        <header className="workspace-toolbar">
          <div>
            <h2>Tree canvas</h2>

            <p>
              Parent nodes should be placed
              above their daughters.
            </p>
          </div>

          <div className="toolbar-buttons">
            <label
              title="Choose whether tree levels grow downward from the root or upward from an aligned terminal row"
              style={{
                display:
                  "inline-flex",
                alignItems:
                  "center",
                gap: 7,
                padding:
                  "7px 10px",
                border:
                  "1px solid #c7ccd4",
                borderRadius: 6,
                background:
                  "#ffffff",
                userSelect:
                  "none",
                fontSize: 14,
              }}
            >
              Tree layout

              <select
                value={
                  treeLayoutMode
                }
                onChange={(event) =>
                  setTreeLayoutMode(
                    event.target
                      .value as
                      TreeLayoutMode,
                  )
                }
                aria-label="Tree layout direction"
                style={{
                  minHeight: 28,
                  border:
                    "1px solid #aeb5bf",
                  borderRadius: 4,
                  background:
                    "#ffffff",
                  font: "inherit",
                }}
              >
                <option value="topDown">
                  Top-down
                </option>

                <option value="bottomUp">
                  Bottom-up
                </option>
              </select>
            </label>

            <label
              title="Hide X-prime levels that have one daughter, or that are the only daughter of their parent, and promote their daughters upward"
              style={{
                display:
                  "inline-flex",
                alignItems:
                  "center",
                gap: 7,
                padding:
                  "7px 10px",
                border:
                  "1px solid #c7ccd4",
                borderRadius: 6,
                background:
                  "#ffffff",
                cursor:
                  "pointer",
                userSelect:
                  "none",
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={
                  collapseUnusedBarLevels
                }
                onChange={(event) =>
                  setCollapseUnusedBarLevels(
                    event.target
                      .checked,
                  )
                }
              />

              Remove unused bar levels
            </label>

            <button
  type="button"
  onClick={exportTreeAsPng}
>
  Export PNG
</button>

<button
  type="button"
  onClick={exportTreeAsLatex}
>
  Export LaTeX
</button>
            <button
              type="button"
              onClick={deleteSelected}
            >
              Delete selected
            </button>

            <button
              type="button"
              className="danger-button"
              onClick={clearCanvas}
            >
              Clear canvas
            </button>
          </div>
        </header>

        <div
  ref={flowCanvasRef}
  className="flow-canvas"
  style={{
    position: "relative",
    cursor:
      selectionBoxActive
        ? "crosshair"
        : undefined,
  }}
  onDragOver={
    handleCanvasDragOver
  }
  onDrop={handleCanvasDrop}
>
  <div
    aria-label="Canvas editing controls"
    onPointerDown={(event) =>
      event.stopPropagation()
    }
    style={{
      position: "absolute",
      top: 12,
      left: 12,
      zIndex: 20,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: 7,
      border:
        "1px solid #c7ccd4",
      borderRadius: 8,
      background:
        "rgba(255,255,255,0.95)",
      boxShadow:
        "0 2px 8px rgba(0,0,0,0.09)",
    }}
  >
    <button
      type="button"
      aria-pressed={
        selectionBoxActive
      }
      onClick={() =>
        setSelectionBoxActive(
          (currentValue) =>
            !currentValue,
        )
      }
      title={
        selectionBoxActive
          ? "Selection box is active. Drag across the canvas to select multiple nodes."
          : "Activate the selection box tool"
      }
      style={{
        minHeight: 34,
        padding: "0 9px",
        border:
          "1px solid #c7ccd4",
        borderRadius: 6,
        background:
          selectionBoxActive
            ? "#e6edf8"
            : "#ffffff",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Select box
    </button>

    <button
      type="button"
      onClick={
        addBlankLexicalBoxes
      }
      disabled={
        selectedHeadNodes.length ===
        0
      }
      title={
        selectedHeadNodes.length > 0
          ? "Add one blank lexical daughter to each selected head"
          : "Select a head node before adding a lexical box"
      }
      style={{
        minHeight: 34,
        padding: "0 9px",
        border:
          "1px solid #c7ccd4",
        borderRadius: 6,
        background: "#ffffff",
        fontWeight: 600,
        cursor:
          selectedHeadNodes.length > 0
            ? "pointer"
            : "not-allowed",
      }}
    >
      Add lexical box
    </button>

    <button
      type="button"
      className="undo-button"
      onClick={undoLastAction}
      disabled={undoCount === 0}
      title="Undo the last action (Ctrl+Z)"
    >
      Undo

      <span className="undo-shortcut">
        Ctrl+Z
      </span>
    </button>

    <span
      role="group"
      aria-label="Text formatting"
      title="Select one or more boxes, then apply text formatting"
      style={{
        display:
          "inline-flex",
        alignItems:
          "center",
        gap: 4,
      }}
    >
      <button
        type="button"
        aria-label="Toggle bold"
        aria-pressed={
          selectedNodesAreBold
        }
        disabled={
          selectedFormattableNodes
            .length === 0
        }
        onMouseDown={(event) =>
          event.preventDefault()
        }
        onClick={() =>
          toggleSelectedTextFormat(
            "textBold",
          )
        }
        title="Bold (Ctrl+B)"
        style={{
          ...formattingButtonBaseStyle,
          background:
            selectedNodesAreBold
              ? "#e6edf8"
              : "#ffffff",
          fontWeight: 700,
        }}
      >
        B
      </button>

      <button
        type="button"
        aria-label="Toggle italics"
        aria-pressed={
          selectedNodesAreItalic
        }
        disabled={
          selectedFormattableNodes
            .length === 0
        }
        onMouseDown={(event) =>
          event.preventDefault()
        }
        onClick={() =>
          toggleSelectedTextFormat(
            "textItalic",
          )
        }
        title="Italics (Ctrl+I)"
        style={{
          ...formattingButtonBaseStyle,
          background:
            selectedNodesAreItalic
              ? "#e6edf8"
              : "#ffffff",
          fontStyle: "italic",
        }}
      >
        I
      </button>

      <button
        type="button"
        aria-label="Toggle strikethrough"
        aria-pressed={
          selectedNodesAreStruck
        }
        disabled={
          selectedFormattableNodes
            .length === 0
        }
        onMouseDown={(event) =>
          event.preventDefault()
        }
        onClick={() =>
          toggleSelectedTextFormat(
            "textStrikethrough",
          )
        }
        title="Strikethrough"
        style={{
          ...formattingButtonBaseStyle,
          background:
            selectedNodesAreStruck
              ? "#e6edf8"
              : "#ffffff",
          textDecoration:
            "line-through",
        }}
      >
        S
      </button>
    </span>
  </div>

  <aside
    aria-label="Bar-level attachment shortcuts"
    onPointerDown={(event) =>
      event.stopPropagation()
    }
    style={{
      position: "absolute",
      left: 56,
      bottom: 12,
      zIndex: 20,
      display: "grid",
      gap: 3,
      padding: "7px 9px",
      border:
        "1px solid #c7ccd4",
      borderRadius: 7,
      background:
        "rgba(255,255,255,0.95)",
      boxShadow:
        "0 2px 8px rgba(0,0,0,0.08)",
      fontSize: 12,
      lineHeight: 1.25,
      userSelect: "none",
      pointerEvents: "auto",
    }}
  >
    <strong
      style={{
        fontSize: 12,
      }}
    >
      Drop on X′
    </strong>

    <span>
      Ctrl/Cmd + release:
      Complement
    </span>

    <span>
      Alt + release: Adjunct
    </span>

    <span
      style={{
        color: "#5f6670",
      }}
    >
      No key: choose
    </span>
  </aside>

  <div
    aria-label="Canvas display controls"
    onPointerDown={(event) =>
      event.stopPropagation()
    }
    style={{
      position: "absolute",
      top: 12,
      right: 12,
      zIndex: 20,
      display: "grid",
      gap: 6,
      minWidth: 190,
      padding: 9,
      border:
        "1px solid #c7ccd4",
      borderRadius: 8,
      background:
        "rgba(255,255,255,0.95)",
      boxShadow:
        "0 2px 8px rgba(0,0,0,0.09)",
      fontSize: 14,
    }}
  >
    <label
      title="Show or hide boxes around all phrase, category, and word labels"
      style={{
        display:
          "inline-flex",
        alignItems:
          "center",
        gap: 7,
        cursor:
          "pointer",
        userSelect:
          "none",
      }}
    >
      <input
        type="checkbox"
        checked={
          showNodeBoxes
        }
        onChange={(event) =>
          setShowNodeBoxes(
            event.target.checked,
          )
        }
      />

      Show boxes
    </label>

    <label
      title="Show or hide all curved movement arrows"
      style={{
        display:
          "inline-flex",
        alignItems:
          "center",
        gap: 7,
        cursor:
          "pointer",
        userSelect:
          "none",
      }}
    >
      <input
        type="checkbox"
        checked={
          showMovementArrows
        }
        onChange={(event) =>
          setShowMovementArrows(
            event.target.checked,
          )
        }
      />

      Show movement arrows
    </label>

    <label
      title="Show or hide the vertical line between a head and its lexical word"
      style={{
        display:
          "inline-flex",
        alignItems:
          "center",
        gap: 7,
        cursor:
          "pointer",
        userSelect:
          "none",
      }}
    >
      <input
        type="checkbox"
        checked={
          showHeadWordLines
        }
        onChange={(event) =>
          setShowHeadWordLines(
            event.target.checked,
          )
        }
      />

      Show head-word lines
    </label>

    <button
      type="button"
      onClick={loadDemoTree}
      title="Replace the current canvas with the demonstration tree"
      style={{
        minHeight: 34,
        marginTop: 3,
        border:
          "1px solid #8c96a3",
        borderRadius: 6,
        background: "#ffffff",
        fontWeight: 700,
        letterSpacing: "0.04em",
        cursor: "pointer",
      }}
    >
      DEMO
    </button>
  </div>

          <DisplayOptionsContext.Provider
  value={{
    showNodeBoxes,
    showMovementArrows,
    showHeadWordLines,
    collapseUnusedBarLevels,
    treeLayoutMode,
    requestAutoBalance:
      scheduleAutoBalance,
  }}
>
  <UndoContext.Provider
    value={saveUndoSnapshot}
  >
  <ReactFlow
    nodes={displayedNodes}
    edges={displayedEdges}
    nodeTypes={nodeTypes}
    edgeTypes={edgeTypes}
    onNodesChange={onNodesChange}
    onEdgesChange={onEdgesChange}
    onConnect={onConnect}
    onNodeDragStart={
      handleNodeDragStart
    }
    onNodeDragStop={
      handleNodeDragStop
    }
    onInit={
      setReactFlowInstance
    }
    selectionOnDrag={
      selectionBoxActive
    }
    panOnDrag={
      !selectionBoxActive
    }
    nodesDraggable={
      !selectionBoxActive
    }
    selectionKeyCode={null}
    deleteKeyCode={null}
    defaultEdgeOptions={{
      type: "tree",
    }}
    fitView
  >
    <Background
      gap={24}
      size={1}
    />

    <Controls />
  </ReactFlow>
  </UndoContext.Provider>
</DisplayOptionsContext.Provider>
        </div>
      </main>
    
    {pendingBarAttachment && (
  <div
    className="attachment-dialog-backdrop"
    role="presentation"
  >
    <section
      className="attachment-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attachment-dialog-title"
    >
      <h2 id="attachment-dialog-title">
        Select attachment type
      </h2>

      <p>
        Should{" "}
        <strong>
          {nodes.find(
            (node) =>
              node.id ===
              pendingBarAttachment.draggedId,
          )?.data.label || "this node"}
        </strong>{" "}
        attach to{" "}
        <strong>
          {nodes.find(
            (node) =>
              node.id ===
              pendingBarAttachment.parentId,
          )?.data.label || "the bar level"}
        </strong>{" "}
        as a complement or an adjunct?
      </p>

      <div className="attachment-explanations">
        <p>
          <strong>Complement:</strong>{" "}
          direct daughter of the existing
          bar level and sister of the head.
        </p>

        <p>
          <strong>Adjunct:</strong>{" "}
          creates a new bar level above the
          existing one.
        </p>
      </div>

      <div className="attachment-dialog-actions">
        <button
          type="button"
          onClick={() =>
            attachDirectly(
              pendingBarAttachment,
            )
          }
        >
          Complement
        </button>

        <button
          type="button"
          className="main-button"
          onClick={() =>
            attachAsAdjunct(
              pendingBarAttachment,
            )
          }
        >
          Adjunct
        </button>

        <button
          type="button"
          className="cancel-attachment-button"
          onClick={() =>
            setPendingBarAttachment(
              null,
            )
          }
        >
          Cancel
        </button>
      </div>
    </section>
  </div>
)}</div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <TreeBuilder />
    </ReactFlowProvider>
  );
}

export default App;
