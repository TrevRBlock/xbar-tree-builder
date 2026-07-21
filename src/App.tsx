import {
  useCallback,
  useRef,
  useState,
  useEffect,
  type DragEvent,
} from "react";

import { toPng } from "html-to-image";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  getNodesBounds,
  getViewportForBounds,
  type Connection,
type Edge,
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
  | "wordInput";

interface SyntaxNodeData
  extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
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
  | "CP"
  | "TP"
  | "NP"
  | "VP"
  | "PP"
  | "AdjP"
  | "AdvP"
  | "AuxP";

const projectionChains: Record<
  MaximalProjection,
  readonly [
    phrase: string,
    intermediate: string,
    head: string,
  ]
> = {
  CP: ["CP", "C′", "C"],
  TP: ["TP", "T′", "T"],
  NP: ["NP", "N′", "N"],
  VP: ["VP", "V′", "V"],
  PP: ["PP", "P′", "P"],
  AdjP: ["AdjP", "Adj′", "Adj"],
  AdvP: ["AdvP", "Adv′", "Adv"],
  AuxP: ["AuxP", "Aux′", "Aux"],
};

function isMaximalProjection(
  label: string,
): label is MaximalProjection {
  return Object.prototype.hasOwnProperty.call(
    projectionChains,
    label,
  );
}

const DRAG_DATA_TYPE =
  "application/x-xbar-node";

const phraseLabels: PaletteItem[] = [
  { label: "CP", kind: "phrase" },
  { label: "TP", kind: "phrase" },
  { label: "NP", kind: "phrase" },
  { label: "VP", kind: "phrase" },
  { label: "PP", kind: "phrase" },
  { label: "AdjP", kind: "phrase" },
  { label: "AdvP", kind: "phrase" },
  { label: "AuxP", kind: "phrase" },
];

const headLabels: PaletteItem[] = [
  { label: "D", kind: "head" },
  { label: "N", kind: "head" },
  { label: "V", kind: "head" },
  { label: "P", kind: "head" },
  { label: "Adj", kind: "head" },
  { label: "Adv", kind: "head" },
  { label: "Aux", kind: "head" },
  { label: "T", kind: "head" },
  { label: "C", kind: "head" },
  { label: "Qual", kind: "head" },
];

function SyntaxNodeComponent({
  id,
  data,
  selected,
}: NodeProps<SyntaxNode>) {
  const reactFlow =
    useReactFlow<SyntaxNode, Edge>();

  const updateNodeInternals =
    useUpdateNodeInternals();

  const [isEditing, setIsEditing] =
    useState(false);

  const canHaveChildren =
    data.kind !== "word" &&
    data.kind !== "wordInput";

  /*
   * Recalculate the node's dimensions and handle
   * positions whenever its text changes.
   */
  useEffect(() => {
    const animationFrame =
      requestAnimationFrame(() => {
        updateNodeInternals(id);
      });

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [
    data.label,
    id,
    isEditing,
    updateNodeInternals,
  ]);

  function finishEditing() {
    setIsEditing(false);

    /*
     * Wait for the input to disappear and the normal
     * label to be rendered before measuring and
     * balancing the tree.
     */
    requestAnimationFrame(() => {
      updateNodeInternals(id);

      requestAnimationFrame(() => {
        const currentNodes =
          reactFlow.getNodes();

        const currentEdges =
          reactFlow.getEdges();

        const balancedNodes =
          layoutTreeComponent(
            currentNodes,
            currentEdges,
            id,
          );

        reactFlow.setNodes(balancedNodes);
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
      ]
        .filter(Boolean)
        .join(" ")}
      title="Double-click to edit"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setIsEditing(true);
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="syntax-handle"
      />

      {isEditing ? (
        <span
          className="node-edit-wrapper nodrag nowheel"
          onDoubleClick={(event) =>
            event.stopPropagation()
          }
        >
          <span
            className="node-edit-sizer"
            aria-hidden="true"
          >
            {data.label || "\u00A0"}
          </span>

          <input
            type="text"
            className="editable-node-input nodrag nowheel"
            value={data.label}
            aria-label="Edit node label"
            autoFocus
            spellCheck={false}
            onChange={(event) => {
              reactFlow.updateNodeData(id, {
                label: event.target.value,
              });
            }}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (
                event.key === "Enter" ||
                event.key === "Escape"
              ) {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        </span>
      ) : (
        <span className="syntax-node-label">
          {data.label || "\u00A0"}
        </span>
      )}

      {canHaveChildren && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="syntax-handle"
        />
      )}
    </div>
  );
}

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

    const childEdges = currentEdges.filter(
      (edge) => edge.source === currentNodeId,
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
const LEVEL_GAP = 85;

function getSyntaxNodeWidth(
  node: SyntaxNode,
): number {
  if (node.measured?.width) {
    return node.measured.width;
  }

  const characterCount = Array.from(
    node.data.label,
  ).length;

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
): SyntaxNode[] {
  const nodeById = new Map(
    currentNodes.map((node) => [
      node.id,
      node,
    ]),
  );

  const connectedNodeIds =
    getConnectedNodeIds(
      startingNodeId,
      currentEdges,
    );

  const childEdgesByParent =
    new Map<string, Edge[]>();

  for (const edge of currentEdges) {
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

  for (const edge of currentEdges) {
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
      SISTER_GAP;

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

    newPositions.set(nodeId, {
      x: centreX - nodeWidth / 2,
      y,
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
    SISTER_GAP;

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

    placeSubtree(
      childId,
      childCentreX,
      y + LEVEL_GAP,
    );

    nextChildLeft +=
      childSpan +
      SISTER_GAP;
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
interface PendingBarAttachment {
  parentId: string;
  draggedId: string;
  placeOnLeft: boolean;
  draggedPosition: {
    x: number;
    y: number;
  };
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
  };

  return Array.from(value)
    .map(
      (character) =>
        replacements[character] ??
        character,
    )
    .join("");
}

function formatQtreeLabel(
  label: string,
): string {
  const trimmedLabel =
    label.trim();

  /*
   * Preserve blank lexical nodes without
   * placing instructional text in them.
   */
  if (!trimmedLabel) {
    return "{\\phantom{x}}";
  }

  /*
   * Convert either N′ or N' into a
   * typographically raised prime in LaTeX.
   */
  const primeMatch =
    trimmedLabel.match(
      /^(.*?)[′']$/u,
    );

  if (
    primeMatch &&
    primeMatch[1]
  ) {
    const baseLabel =
      escapeLatexText(
        primeMatch[1],
      );

    return `{${baseLabel}$'$}`;
  }

  return `{${escapeLatexText(
    trimmedLabel,
  )}}`;
}

function createLatexDocument(
  currentNodes:
    readonly SyntaxNode[],
  currentEdges:
    readonly Edge[],
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

  const incomingEdgeCount =
    new Map<string, number>();

  for (const node of currentNodes) {
    incomingEdgeCount.set(
      node.id,
      0,
    );
  }

  for (const edge of currentEdges) {
    if (
      !nodeById.has(edge.source) ||
      !nodeById.has(edge.target)
    ) {
      continue;
    }

    incomingEdgeCount.set(
      edge.target,
      (
        incomingEdgeCount.get(
          edge.target,
        ) ?? 0
      ) + 1,
    );
  }

  const multipleParentNode =
    currentNodes.find(
      (node) =>
        (
          incomingEdgeCount.get(
            node.id,
          ) ?? 0
        ) > 1,
    );

  if (multipleParentNode) {
    throw new Error(
      `${multipleParentNode.data.label || "A node"} has more than one parent. Remove the extra branch before exporting.`,
    );
  }

  const roots =
    currentNodes
      .filter(
        (node) =>
          (
            incomingEdgeCount.get(
              node.id,
            ) ?? 0
          ) === 0,
      )
      .sort(
        (
          firstNode,
          secondNode,
        ) =>
          firstNode.position.x -
          secondNode.position.x,
      );

  if (roots.length === 0) {
    throw new Error(
      "The tree has no root. Check for a circular branch.",
    );
  }

  const visitedNodeIds =
    new Set<string>();

  const activeNodeIds =
    new Set<string>();

  function getOrderedChildEdges(
    parentId: string,
  ): Edge[] {
    return currentEdges
      .filter(
        (edge) =>
          edge.source ===
            parentId &&
          nodeById.has(edge.target),
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

  function buildQtreeNode(
    nodeId: string,
  ): string {
    if (
      activeNodeIds.has(nodeId)
    ) {
      throw new Error(
        "The tree contains a circular branch.",
      );
    }

    if (
      visitedNodeIds.has(nodeId)
    ) {
      throw new Error(
        "A node occurs more than once in the tree.",
      );
    }

    const node =
      nodeById.get(nodeId);

    if (!node) {
      return "";
    }

    activeNodeIds.add(nodeId);
    visitedNodeIds.add(nodeId);

    const formattedLabel =
      formatQtreeLabel(
        node.data.label,
      );

    const childEdges =
      getOrderedChildEdges(
        nodeId,
      );

    if (
      childEdges.length === 0
    ) {
      activeNodeIds.delete(
        nodeId,
      );

      return formattedLabel;
    }

    const children =
      childEdges
        .map((edge) =>
          buildQtreeNode(
            edge.target,
          ),
        )
        .join(" ");

    activeNodeIds.delete(nodeId);

    return `[.${formattedLabel} ${children} ]`;
  }

  const treeCommands =
    roots.map(
      (root) =>
        `\\Tree ${buildQtreeNode(
          root.id,
        )}`,
    );

  if (
    visitedNodeIds.size !==
    currentNodes.length
  ) {
    throw new Error(
      "Some nodes could not be reached from a root. Check the tree branches.",
    );
  }

  return [
    "\\documentclass{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{qtree}",
    "\\pagestyle{empty}",
    "",
    "\\begin{document}",
    "\\centering",
    "",
    treeCommands.join(
      "\n\n\\par\\bigskip\n\n",
    ),
    "",
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

function TreeBuilder() {
  const [
    nodes,
    setNodes,
    onNodesChange,
  ] = useNodesState<SyntaxNode>([]);

  const [
    edges,
    setEdges,
    onEdgesChange,
  ] = useEdgesState<Edge>([]);

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

  const nextNodeNumber = useRef(1);

  const flowCanvasRef =
  useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            type: "straight",
          },
          currentEdges,
        ),
      );
    },
    [setEdges],
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
        edge.target === draggedNode.id,
    );

  /*
   * A tree node may have only one parent.
   */
  const edgesWithoutOldParent =
    edges.filter(
      (edge) =>
        edge.target !== draggedNode.id,
    );

  const existingSisterEdges =
    edgesWithoutOldParent.filter(
      (edge) =>
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
        ? Math.min(
            ...existingOrders,
          ) - 1
        : Math.max(
            ...existingOrders,
          ) + 1;
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

  /*
   * Prevent the dragged subtree from
   * already containing the target bar.
   */
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

  /*
   * This is the edge connecting the old
   * X′ to its current parent.
   */
  const incomingBarEdge =
    edges.find(
      (edge) =>
        edge.target ===
        lowerBarNode.id,
    );

  /*
   * The adjunct may already belong to
   * another part of the tree.
   */
  const previousAdjunctParentEdge =
    edges.find(
      (edge) =>
        edge.target ===
        adjunctNode.id,
    );

  const newBarId =
    `syntax-node-${nextNodeNumber.current}`;

  nextNodeNumber.current += 1;

  /*
   * The new upper X′ uses the same label
   * as the existing lower X′.
   */
  const newUpperBarNode: SyntaxNode = {
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

  /*
   * Remove:
   * 1. the adjunct's previous parent;
   * 2. the old X′'s incoming edge.
   *
   * The old X′'s outgoing edges remain.
   */
  let updatedEdges =
    edges.filter((edge) => {
      if (
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

  /*
   * Insert the new X′ where the old X′
   * previously occurred.
   */
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

  /*
   * The adjunct and old X′ become sisters
   * under the new upper X′.
   */
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

  const nodeSnapshot: SyntaxNode[] = [
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
    );

  /*
   * Rebalance the adjunct's old tree if
   * it was moved from somewhere else.
   */
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
      );
  }

  setEdges(updatedEdges);
  setNodes(balancedNodes);
  setPendingBarAttachment(null);
}

  const handleNodeDragStop:
  OnNodeDrag<SyntaxNode> =
  (_event, draggedNode) => {
    if (!reactFlowInstance) {
      return;
    }

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
            "wordInput",
      );

    if (
      possibleParents.length === 0
    ) {
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

    /*
     * If several nodes overlap, use the
     * node closest to the dragged node.
     */
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
      return;
    }

    const parentCentreX =
      parentNode.position.x +
      getSyntaxNodeWidth(
        parentNode,
      ) /
        2;

    const attachment: PendingBarAttachment = {
      parentId: parentNode.id,
      draggedId: draggedNode.id,
      placeOnLeft:
        draggedCentreX <
        parentCentreX,
      draggedPosition: {
        ...draggedNode.position,
      },
    };

    /*
     * Bar levels require a complement/
     * adjunct decision.
     */
    if (
      isBarLevelLabel(
        parentNode.data.label,
      )
    ) {
      setPendingBarAttachment(
        attachment,
      );

      return;
    }

    /*
     * Other node types attach normally.
     */
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
        edge.source === parentNode.id,
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
              LEVEL_GAP,
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
              LEVEL_GAP * 2,
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
              LEVEL_GAP * 3,
          },
          data: {
            label: "",
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
              LEVEL_GAP,
          },
          data: {
            label: "",
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
      setNodes((currentNodes) => [
        ...currentNodes,
        ...createdNodes,
      ]);

      setEdges((currentEdges) => [
        ...currentEdges,
        ...createdEdges,
      ]);

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
     * X′ targets require the existing
     * complement/adjunct dialog.
     */
    if (
      isBarLevelLabel(
        targetNode.data.label,
      )
    ) {
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

  function clearCanvas() {
    setNodes([]);
    setEdges([]);
  }

  function deleteSelected() {
    const selectedNodeIds = new Set(
      nodes
        .filter((node) => node.selected)
        .map((node) => node.id),
    );

    setNodes((currentNodes) =>
      currentNodes.filter(
        (node) => !node.selected,
      ),
    );

    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) =>
          !edge.selected &&
          !selectedNodeIds.has(
            edge.source,
          ) &&
          !selectedNodeIds.has(
            edge.target,
          ),
      ),
    );
  }

  async function exportTreeAsPng() {
  if (nodes.length === 0) {
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

  /*
   * Close any node editor before taking
   * the image.
   */
  if (
    document.activeElement
      instanceof HTMLElement
  ) {
    document.activeElement.blur();
  }

  const imageWidth = 1600;
  const imageHeight = 1200;

  const nodesBounds =
    getNodesBounds(nodes);

  const exportViewport =
    getViewportForBounds(
      nodesBounds,
      imageWidth,
      imageHeight,
      0.1,
      2,
      0.12,
    );

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

          /*
           * Two pixels per output pixel
           * gives a sharper result.
           */
          pixelRatio: 2,
          cacheBust: true,

          style: {
            width:
              `${imageWidth}px`,

            height:
              `${imageHeight}px`,

            transform:
              `translate(${exportViewport.x}px, ${exportViewport.y}px) scale(${exportViewport.zoom})`,
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
        nodes,
        edges,
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
        The tree automatically balances
        after the new subtree is attached.
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
        choice.
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
        Double-click a blank lexical
        terminal to enter a word.
      </li>

      <li>
        The node expands automatically as
        more text is entered.
      </li>

      <li>
        Press Enter or Escape, or click
        outside the node, to finish
        editing.
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
        Click a node or branch line to
        select it.
      </li>

      <li>
        Press Delete or Backspace, or use
        Delete selected in the toolbar.
      </li>

      <li>
        Clear canvas removes every node
        and branch from the workspace.
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
        .tex document using the qtree
        package and the \Tree command.
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
  onDragOver={
    handleCanvasDragOver
  }
  onDrop={handleCanvasDrop}
>
          <ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  onNodesChange={
    onNodesChange
  }
  onEdgesChange={
    onEdgesChange
  }
  onConnect={onConnect}
  onNodeDragStop={
    handleNodeDragStop
  }
            onInit={
              setReactFlowInstance
            }
            deleteKeyCode={[
              "Backspace",
              "Delete",
            ]}
            defaultEdgeOptions={{
              type: "straight",
              style: {
                strokeWidth: 2,
              },
            }}
            fitView
          >
            <Background
              gap={24}
              size={1}
            />

            <Controls />
          </ReactFlow>
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