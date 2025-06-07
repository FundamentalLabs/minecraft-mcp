import { closest } from 'fastest-levenshtein';
import mcData from 'minecraft-data';
import { Bot } from 'mineflayer';
import mineflayer_pathfinder from 'mineflayer-pathfinder';

import { ISkillServiceParams } from '../../types/skillType.js';
import { isSignalAborted } from '../index.js';
import { asyncwrap } from './asyncwrap.js';
import { findClosestItemName } from './findClosestItemName.js';
import { getInventory } from './inventoryHelpers.js';

const {
  goals: { GoalNear },
} = mineflayer_pathfinder;

export const getFuelBurnTime = (fuelName: string): number => {
  const fuelBurnTimes: { [key: string]: number } = {
    stick: 100,
    wooden_slab: 150,
    sapling: 100,
    wooden_axe: 200,
    wooden_hoe: 200,
    wooden_pickaxe: 200,
    wooden_shovel: 200,
    wooden_sword: 200,
    planks: 300,
    log: 300,
    coal: 1600,
    charcoal: 1600,
    lava_bucket: 20000,
    coal_block: 16000,
    blaze_rod: 2400,
  };
  // get the closest matching name in the fuel burn times array
  const closestFuelName = closest(
    fuelName.toLowerCase(),
    Object.keys(fuelBurnTimes),
  );
  return fuelBurnTimes[closestFuelName] / 20; // convert ticks to seconds
};

// These are all helper functions because mineflayer is not updating furnace item and fuel progress
export const ticksToSeconds = (ticks: number): number => {
  return ticks * 0.05;
};

export const secondsToTicks = (seconds: number): number => {
  return seconds * 20;
};

type FurnacePacket = {
  totalFuel: number;
  currentFuel: number;
  totalProgress: number;
  currentProgress: number;
};

type Furnace = {
  totalFuel: number;
  totalFuelSeconds: number;
  fuel: number;
  fuelSeconds: number;
  totalProgress?: number;
  totalProgressSeconds?: number;
  progress?: number;
  progressSeconds?: number;
};

interface IGetFuelSeconds {
  furnace: Furnace;
  packet: FurnacePacket;
}

const getFuelSeconds = ({ furnace, packet }: IGetFuelSeconds): number => {
  furnace.totalFuel = packet.totalFuel;
  furnace.totalFuelSeconds = ticksToSeconds(furnace.totalFuel);
  furnace.fuel = 0;
  furnace.fuelSeconds = 0;

  if (furnace.totalFuel) {
    furnace.fuel = packet.totalFuel / furnace.totalFuel;
    furnace.fuelSeconds = furnace.fuel * furnace.totalFuelSeconds;
  }
  return furnace.fuelSeconds;
};

const getItemProgress = ({ furnace, packet }: IGetFuelSeconds): number => {
  furnace.totalProgress = packet.totalProgress;
  furnace.totalProgressSeconds = ticksToSeconds(furnace.totalProgress);
  furnace.progress = 0;
  furnace.progressSeconds = 0;
  if (furnace.totalProgress) {
    furnace.progress = packet.totalProgress / furnace.totalProgress;
    furnace.progressSeconds =
      furnace.totalProgressSeconds -
      furnace.progress * furnace.totalProgressSeconds;
  }
  return furnace.progressSeconds;
};

interface IUseFurnaceOptions {
  itemName: string;
  fuelName: string;
  count: number;
  action: string;
  signal: AbortSignal;
  getStatsData: ISkillServiceParams['getStatsData'];
  setStatsData: ISkillServiceParams['setStatsData'];
}
/**
 * Smelt specified item(s) in Minecraft.
 *
 * @param {object} bot - The Mineflayer bot instance. Assume the bot is already spawned in the world.
 * @param {object} options
 * @param {string} options.itemName - The name of the item to cook.
 * @param {string} options.fuelName - The name of the fuel used for cooking. Must be a resource from your inventory.
 * @param {number} options.count - The minimum number of items to craft. Defaults to 1, maximum is 64
 * @param {string} options.action - The action to perform. Defaults to "smelt", could be "smelt" or "cook".
 * @param {AbortSignal} options.signal - The signal to abort the skill.
 * @param {ISkillServiceParams['getStatsData']} options.getStatsData - The function to get the stats data.
 * @param {ISkillServiceParams['setStatsData']} options.setStatsData - The function to set the stats data.
 *
 */

export const useFurnace = async (
  bot: Bot,
  options: IUseFurnaceOptions,
): Promise<boolean> => {
  /*
    Behavior:
        - If furnace is in progress, take output items
        - If furnace is not in progress, take all items if there are any, then smelt.
        - There is no waiting at any given time. After smelting, the bot is free do other things.
        - Delayed progress and end observations are used to inform the user of the progress and completion of the smelting process.

    Text sending is in accords with Andrew's process awareness:
        - A single start observation
        - Intermediate text observations should not sound like the process is ending
        - A single end observation. In this case, it is a delayed end observation.
    */

  // this is a constant smelt time in minecraft, even if the item is different everything takes 10 seconds to smelt
  const defaultOptions = {
    count: 1,
    action: 'smelt',
  };

  let { itemName, fuelName, count, action, signal, getStatsData, setStatsData } =
    { ...defaultOptions, ...options };
  const smeltTime = 10;

  // return if itemName or fuelName is not string
  if (typeof itemName !== 'string' || typeof fuelName !== 'string') {
    return bot.emit(
      'alteraBotEndObservation',
      `Mistake: item '${itemName}' or fuel '${fuelName}' for smeltItem must be a string`,
    );
  }
  // return if count is not a number
  if (typeof count !== 'number' || isNaN(count)) {
    return bot.emit(
      'alteraBotEndObservation',
      'Mistake: count for smeltItem must be a number',
    );
  }

  const closestItemName = findClosestItemName(bot, { name: itemName });
  if (!closestItemName) {
    return bot.emit(
      'alteraBotEndObservation',
      `Mistake: You couldn't ${action} item '${itemName}' because there's no item named '${itemName}' in minecraft.`,
    );
  }

  const closestFuelName = findClosestItemName(bot, { name: fuelName });
  if (!closestFuelName) {
    return bot.emit(
      'alteraBotEndObservation',
      `Mistake: You couldn't use fuel '${fuelName}' because there's no item named '${fuelName}' in minecraft.`,
    );
  }

  const NEARBY_DISTANCE = bot.nearbyBlockXZRange;
  const FURNACE_ID_BLOCK = mcData(bot.version).blocksByName.furnace.id;
  const FURNACE_ID_ITEM = mcData(bot.version).itemsByName.furnace.id;
  const botInventory = getInventory(bot, { useItemNames: false });

  itemName = closestItemName; // update the item name to the closest matching name
  fuelName = closestFuelName; // update the fuel name to the closest matching name

  const item = mcData(bot.version).itemsByName[itemName];
  const fuel = mcData(bot.version).itemsByName[fuelName];

  const itemNameDisplayed = item.displayName;
  const fuelNameDisplayed = fuelName.replace(/_/g, ' ');

  // This should never happen as we already checked for the item and fuel name in mcData
  if (!item) {
    return bot.emit(
      'alteraBotEndObservation',
      `Error: There is no item named ${itemName} in Minecraft to smelt.`,
    );
  }
  if (!fuel) {
    return bot.emit(
      'alteraBotEndObservation',
      `Error: There is no fuel named ${fuelName} in Minecraft.`,
    );
  }

  // check for nearby furnace
  const furnaceBlock = bot.findBlock({
    matching: FURNACE_ID_BLOCK,
    maxDistance: NEARBY_DISTANCE,
  });

  // if there is no nearby furnace, check if the bot has a furnace in its inventory to place and return appropriate message
  if (!furnaceBlock) {
    if (botInventory?.[FURNACE_ID_ITEM] > 0) {
      return bot.emit(
        'alteraBotEndObservation',
        `To ${action} ${itemNameDisplayed} requires using a furnace. There's no furnace nearby but there's one in your inventory. You should place it down.`,
      );
    } else {
      return bot.emit(
        'alteraBotEndObservation',
        `To ${action} ${itemNameDisplayed} requires using a furnace. There's no furnace nearby and you don't have one, so you need to craft one.`,
      );
    }
  }

  // check if the bot has cancelled the action (abort signalled)
  if (isSignalAborted(signal)) {
    return bot.emit(
      'alteraBotEndObservation',
      `You decided to do something else and stopped smelting.`,
    );
  }

  // make sure we can see the furnace by pathing to look at it
  try {
    await asyncwrap({
      func: async () => {
        return bot.pathfinder.goto(
          new GoalNear(
            furnaceBlock.position.x,
            furnaceBlock.position.y,
            furnaceBlock.position.z,
            2,
          ),
        );
      },
      getStatsData,
      setStatsData,
    });
    // force the bot to look at as occasionally the bot will not look at the even after pathing
    bot.lookAt(furnaceBlock.position.offset(0.5, 0.5, 0.5));
    console.log(
      `You are looking at the furnace at ${Math.floor(furnaceBlock.position.x)}, ${Math.floor(furnaceBlock.position.y)}, ${Math.floor(furnaceBlock.position.z)}.`,
    );
  } catch (err) {
    const error = err as Error;
    console.log(error.message);
    return bot.emit(
      'alteraBotEndObservation',
      `You can't reach the furnace. It was too difficult to reach it.`,
    );
  }

  // pathing might take a while, so check if the bot has cancelled the action (abort signalled)
  if (isSignalAborted(signal)) {
    return bot.emit(
      'alteraBotEndObservation',
      `You decided to do something else and stopped smelting.`,
    );
  }

  try {
    // Because crafting and chest interfaces allow for smelting, we need to make sure we exit any open windows
    // TODO: PROBABLY DELETE THIS
    // exitInterface(bot);

    /*
        Mineflayer currently does not update the furnace item and fuel progress correctly.
        Item smelting and fuel burning progress are both null due to packet update errors.
        The code block below is a temporary workaround to get the progress of the furnace.
        */
    const furnaceInfo: { [key: string]: any } = {};
    const furnaceInfoFunction = (packet: { [key: string]: any }) => {
      furnaceInfo[packet.property] = packet.value;
    };
    bot._client.on('craft_progress_bar', furnaceInfoFunction);
    const furnace = await asyncwrap({
      func: async () => {
        return await bot.openFurnace(furnaceBlock);
      },
      getStatsData,
      setStatsData,
    });
    await bot.waitForTicks(1);
    bot._client.removeListener('craft_progress_bar', furnaceInfoFunction);
    getFuelSeconds({ furnace, packet: furnaceInfo as FurnacePacket });
    getItemProgress({ furnace, packet: furnaceInfo as FurnacePacket });
    console.log(`Current fuel progress: ${furnace.fuelSeconds}`);
    console.log(`Current item progress: ${furnace.progressSeconds}`);
    furnace.fuelSeconds.toFixed(1);
    const furnaceProgressSeconds = furnace.progressSeconds.toFixed(1);

    const start_message_elements = [];
    let start_message = '';
    // if the furnace is not smelting, take out all items. Note that fuel item could be in the furnace despite zero progress time because input item could be unsmeltable.
    if (furnaceProgressSeconds == 10 || furnaceProgressSeconds == 0) {
      console.log('Furnace is not smelting. Taking out all items.');
      if (furnace.inputItem()) {
        const ir = await furnace.takeInput();
        start_message_elements.push(
          `you retrieved ${ir.count} ${ir.displayName} from the furnace input slot`,
        );
      }
      if (furnace.fuelItem()) {
        const fr = await furnace.takeFuel();
        start_message_elements.push(
          `you retrieved ${fr.count} ${fr.displayName} from the furnace fuel slot`,
        );
      }
      if (furnace.outputItem()) {
        const outr = await furnace.takeOutput();
        start_message_elements.push(
          `you retrieved ${outr.count} ${outr.displayName} from the furnace output slot`,
        );
      }

      if (start_message_elements.length != 0) {
        start_message = 'Before smelting, ';
        for (let i = 0; i < start_message_elements.length; i++) {
          if (
            start_message_elements.length > 1 &&
            i == start_message_elements.length - 1
          ) {
            start_message += 'and ';
          }
          start_message += start_message_elements[i];
          if (i < start_message_elements.length - 1) {
            start_message += ', ';
          } else {
            start_message += '. ';
          }
        }
        bot.emit('alteraBotTextObservation', start_message);
      }
    } else {
      // If furnace is in use, get the time to finish and leave the furnace
      const total_wait_time =
        furnaceProgressSeconds + (furnace.inputItem().count - 1) * smeltTime;
      console.log(
        `Furnace is in progress and will be free for ${action} in ${total_wait_time} seconds.`,
      );
      return bot.emit(
        'alteraBotEndObservation',
        `Furnace is in progress and will be free for ${action} in ${total_wait_time} seconds.`,
      );
    }

    // At this point, input, fuel, and output should all be empty, and there may be a non-zero fuel burning time
    if (!furnace.inputItem() && !furnace.fuelItem() && !furnace.outputItem()) {
      console.log('Furnace is empty.');
    } else {
      furnace.close();
      console.log(
        `ERROR: The furnace is not empty after attempted retrieval of all items. This should not happen.`,
      );
      return bot.emit(
        'alteraBotEndObservation',
        `ERROR: The furnace is not empty after attempted retrieval of all items. This should not happen.`,
      );
    }

    // IT'S SMELTING TIME
    console.log("It's smelting time!");

    // TODO: Determine the amount of fuel to put into the furnace. There is still possibly fuel burning in the furnace, but we will ignore that for now.
    let itemCount = 0;
    let fuelCount = 0;
    const itemsPerFuel = getFuelBurnTime(fuelName) / smeltTime;
    const fuelInInventory = botInventory?.[fuel.id]; // this is the amount of fuel the bot has
    const itemInInventory = botInventory?.[item.id]; // this is the amount of items the bot has
    const matchingFuelAndItem = fuel.id === item.id; // check to see if the item and fuel are the same
    if (!matchingFuelAndItem) {
      // check if the bot does not have the input item or if there is less input item than the amount requested
      if (!itemInInventory || itemInInventory < 1) {
        console.log(
          `You don't have any ${itemNameDisplayed} to ${action}.`,
        );
        return bot.emit(
          'alteraBotEndObservation',
          `You don't have any ${itemNameDisplayed} to ${action}.`,
        );
      }
      if (itemInInventory < count) {
        console.log(
          `You wanted to smelt ${count} ${itemNameDisplayed} but you only had ${itemInInventory}.`,
        );
      }

      // check if the bot does not have the fuel item or if there is less fuel item than the amount requested
      const fuelNeeded = Math.ceil(count / itemsPerFuel);
      if (!fuelInInventory || fuelInInventory < 1) {
        console.log(
          `You don't have any ${fuelNameDisplayed} to ${action} ${count} of ${itemNameDisplayed}`,
        );
        return bot.emit(
          'alteraBotEndObservation',
          `You don't have any ${fuelNameDisplayed} to ${action} ${count} of ${itemNameDisplayed}`,
        );
      }
      if (fuelInInventory < fuelNeeded) {
        console.log(
          `You wanted to smelt ${count} ${itemNameDisplayed}, which requires ${fuelNeeded} of ${fuelNameDisplayed} but you only had ${fuelInInventory}.`,
        );
      }

      // calculate the maximum amount that can be crafted
      const maxItemsFromFuelInInventory = Math.floor(
        itemsPerFuel * fuelInInventory,
      );
      const maxCount = Math.min(itemInInventory, maxItemsFromFuelInInventory);
      if (maxCount < count) {
        console.log(
          `You wanted to smelt ${count} ${itemNameDisplayed}, but given limited input or fuel, you can only ${action} ${maxCount} of ${itemNameDisplayed}.`,
        );
        itemCount = maxCount;
      } else {
        itemCount = count;
      }
      fuelCount = Math.ceil(itemCount / itemsPerFuel);
    } else {
      console.log(
        'Fuel and item are the same, calculating how many items we can smelt',
      );
      itemCount = Math.floor(
        (itemInInventory * itemsPerFuel) / (itemsPerFuel + 1),
      ); // amount of item we can support with the fuel we have, has to be floored / rounded down
      fuelCount = Math.ceil(itemCount / itemsPerFuel); // amount of fuel we can use to smelt
      if (itemCount < 1) {
        console.log(
          `You don't have enough ${itemNameDisplayed} to ${action} ${itemNameDisplayed} since you're using the same items as fuel and input.`,
        );
        return bot.emit(
          'alteraBotEndObservation',
          `You don't have enough ${itemNameDisplayed} to ${action} ${itemNameDisplayed} since you're using the same items as fuel and input.`,
        );
      }
      if (itemCount < count) {
        console.log(
          `You wanted to ${action} ${count} ${itemNameDisplayed}, but that given fuel and input item are the same, and given limited items, you can only ${action} ${itemCount} of ${itemNameDisplayed}.`,
        );
      }
      if (itemCount > count) {
        // if we have more items than we need, we only need to smelt the amount we need
        itemCount = count;
        fuelCount = Math.ceil(itemCount / itemsPerFuel);
      }
    }

    // Start smelting
    await asyncwrap({
      func: async () => {
        return await furnace.putFuel(fuel.id, null, fuelCount);
      },
      getStatsData,
      setStatsData,
    });
    await asyncwrap({
      func: async () => {
        return await furnace.putInput(item.id, null, itemCount);
      },
      getStatsData,
      setStatsData,
    });

    const timeToSmelt = itemCount * smeltTime;
    const location = `(${Math.floor(furnaceBlock.position.x)}, ${Math.floor(furnaceBlock.position.y)}, ${Math.floor(furnaceBlock.position.z)})`;
    const message = `You started ${action}ing ${itemCount} ${itemNameDisplayed} using ${fuelCount} ${fuelNameDisplayed} at ${location}. It will be ready for retrieval in ${timeToSmelt} seconds.`;
    console.log(message);
    bot.emit('alteraBotTextObservation', `${message}`); // force this to be a text observation so it doesn't get ignored
    bot.emit(
      'alteraBotDelayedEndObservation',
      `${itemCount} ${itemNameDisplayed} is done ${action}ing at ${location} and is ready for retrieval.`,
      timeToSmelt,
    );

    furnace.close();
    return;
  } catch (error) {
    const furnace = await asyncwrap({
      func: async () => {
        return await bot.openFurnace(furnaceBlock);
      },
      getStatsData,
      setStatsData,
    });
    if (furnace) furnace.close();
    console.log(
      `Error: failing ${action} ${itemNameDisplayed} because of error ${error}. Closing the furnace and not taking any items.`,
    );
    return bot.emit(
      'alteraBotEndObservation',
      `Error: failing ${action} ${itemNameDisplayed} because of error ${error}. Closing the furnace and not taking any items.`,
    );
  }
};


