import inquirer from 'inquirer';
import Auction from './auction.js';

const auctionClient = new Auction();

const promptUser = async () => {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: ['Open Auction', 'Place Bid', 'Close Auction', 'Exit'],
    },
  ]);

  switch (action) {
    case 'Open Auction':
      await openAuctionPrompt();
      break;
    case 'Place Bid':
      await placeBidPrompt();
      break;
    case 'Close Auction':
      await closeAuctionPrompt();
      break;
    case 'Exit':
      process.exit();
      break;
  }

  promptUser();
};

const openAuctionPrompt = async () => {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'auctionId', message: 'Enter auction ID:' },
    { type: 'input', name: 'item', message: 'Enter item name:' },
    { type: 'input', name: 'startingPrice', message: 'Enter starting price:' },
  ]);

  await auctionClient.handleOpenAuction(answers, true);
};

const placeBidPrompt = async () => {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'auctionId', message: 'Enter auction ID:' },
    { type: 'input', name: 'bidAmount', message: 'Enter bid amount:' },
    { type: 'input', name: 'bidder', message: 'Enter your bidder name:' },
  ]);

  await auctionClient.handlePlaceBid(answers, true);
};

const closeAuctionPrompt = async () => {
  const answers = await inquirer.prompt([
    { type: 'input', name: 'auctionId', message: 'Enter auction ID to close:' },
  ]);

  await auctionClient.handleCloseAuction(answers, true)
};

auctionClient.setupDatabase().then(async () => {
  await auctionClient.listen();

  promptUser();
}).catch(console.error);
