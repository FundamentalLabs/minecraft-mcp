import {Bot} from 'mineflayer';

interface IFindExplorableChunkOptions {
  feature?: string;
}
/**
 *
 * Uses A* search to find the nearest explorable chunk
 * @param {Bot} bot - The Mineflayer bot instance.
 * @param {IFindExplorableChunkOptions} options - The options for the function.
 * @param {IFindExplorableChunkOptions['feature']} options.feature // If a chunk has this feature, the algorithm will prioritize it
 */
export const findExplorableChunk = (
  bot: Bot,
  options: IFindExplorableChunkOptions,
): null | IChunk => {
  const {feature} = options;
  const ELEVATION_DIFFERENCE_WEIGHT = 3;

  const startChunk = getChunk(bot);
  if (!startChunk) return null;

  const frontier = new PriorityQueue();
  frontier.enqueue(startChunk, 0);

  const cameFrom: {[key: string]: IChunk} = {};
  const costSoFar: {[key: string]: number} = {};
  const startKey = `${startChunk.x},${startChunk.y},${startChunk.z}`;
  let searchForFeature = false;

  // Check for whether the starting chunk has the feature in question
  if (feature && bot.knownChunks[startKey] != undefined) {
    searchForFeature = true;
  }

  cameFrom[startKey] = null;
  costSoFar[startKey] = 0;

  const startTime = Date.now();
  const timeout = 500; // Half a second

  while (!frontier.isEmpty() && Date.now() - startTime < timeout) {
    const currentChunk = frontier.dequeue();
    const currentKey = `${currentChunk.x},${currentChunk.y},${currentChunk.z}`;

    if (bot.knownChunks[currentKey] === undefined) {
      return currentChunk;
    }

    const neighbors = getNeighbors(bot, {chunk: currentChunk});
    for (const next of neighbors) {
      const nextKey = `${next.x},${next.y},${next.z}`;
      let newCost = costSoFar[currentKey] + 1; // Assume the cost between any two neighbors is 1

      // Add the difference in elevation to the cost
      // This is to make the bot prefer chunks that are closer to its current elevation, increasing its ability to explore farther.
      const y_difference = Math.abs(next.y - currentChunk.y);
      newCost += y_difference * ELEVATION_DIFFERENCE_WEIGHT;

      // If the feature is found, make it more likely that the bot will explore that chunk
      if (
        searchForFeature &&
        bot.knownChunks[nextKey] != undefined &&
        bot.knownChunks[nextKey][feature]
      ) {
        newCost -= 0.5;
      }

      if (costSoFar[nextKey] === undefined || newCost < costSoFar[nextKey]) {
        costSoFar[nextKey] = newCost;
        const priority =
          newCost +
          Math.abs(next.x - startChunk.x) +
          Math.abs(next.y - startChunk.y) +
          Math.abs(next.z - startChunk.z);
        frontier.enqueue(next, priority);
        cameFrom[nextKey] = currentChunk;
      }
    }
  }

  if (!frontier.isEmpty()) {
    // Just choose a chunk, man
    const currentChunk = frontier.dequeue();
    return currentChunk;
  }

  return null; // Return null if no explorable chunk is found
};

interface IChunk {
  x: number;
  y: number;
  z: number;
  parentChunk?: IChunk;
  direction?: string;
}
/**
 * Get the chunk the bot is currently in
 * @param {Bot} bot - The Mineflayer bot instance.
 *
 * @return {Object} - The chunk the bot is currently in.
 */
const getChunk = (bot: Bot): IChunk => {
  if (bot.entity) {
    return {
      x: Math.floor(bot.entity.position.x / bot.exploreChunkSize),
      y: Math.floor(bot.entity.position.y / bot.exploreChunkSize),
      z: Math.floor(bot.entity.position.z / bot.exploreChunkSize),
    };
  } else {
    return null;
  }
};

interface IGetNeighborsOptions {
  chunk: IChunk;
}
/**
 * Get the neighbors of a chunk
 * @param {Bot} bot - The Mineflayer bot instance.
 * @param {IGetNeighborsOptions} options - The options for the function.
 * @param {IGetNeighborsOptions['chunk']} options.chunk - The chunk to get neighbors for.
 *
 * @return {IChunk[]} - An array of neighboring chunks.
 */
const getNeighbors = (bot: Bot, options: IGetNeighborsOptions): IChunk[] => {
  const {chunk} = options;
  const directions = ['north', 'south', 'east', 'west', 'up', 'down'];
  // shuffle directions fairly
  for (let i = directions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }

  const chunkKey = `${chunk.x},${chunk.y},${chunk.z}`;
  const neighbors = [];
  for (const direction of directions) {
    if (bot.knownChunks[chunkKey][direction]) {
      switch (direction) {
        case 'north':
          neighbors.push({
            x: chunk.x,
            y: chunk.y,
            z: chunk.z - 1,
            parentChunk: chunk,
            direction,
          });
          break;
        case 'south':
          neighbors.push({
            x: chunk.x,
            y: chunk.y,
            z: chunk.z + 1,
            parentChunk: chunk,
            direction,
          });
          break;
        case 'east':
          neighbors.push({
            x: chunk.x + 1,
            y: chunk.y,
            z: chunk.z,
            parentChunk: chunk,
            direction,
          });
          break;
        case 'west':
          neighbors.push({
            x: chunk.x - 1,
            y: chunk.y,
            z: chunk.z,
            parentChunk: chunk,
            direction,
          });
          break;
        case 'up':
          neighbors.push({
            x: chunk.x,
            y: chunk.y + 1,
            z: chunk.z,
            parentChunk: chunk,
            direction,
          });
          break;
        case 'down':
          neighbors.push({
            x: chunk.x,
            y: chunk.y - 1,
            z: chunk.z,
            parentChunk: chunk,
            direction,
          });
          break;
      }
    }
  }

  return neighbors;
};

// Priority Queue Implementation
class PriorityQueue {
  public elements: {item: IChunk; priority: number}[];
  constructor() {
    this.elements = [];
  }

  enqueue(item: IChunk, priority: number) {
    this.elements.push({item, priority});
    this.elements.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    return this.elements.shift().item;
  }

  isEmpty() {
    return this.elements.length === 0;
  }
}


